/**
 * Thread（会话线程）持久化存储
 *
 * 将 ThreadDefinition 存储到 .home/threads/{threadId}.json，
 * 提供 CRUD 操作，启动时扫描目录加载索引。
 *
 * 设计：
 *   - 每个 Thread 独立 JSON 文件
 *   - threadId 使用 Snowflake ID（有序，BigInt 字符串）
 *   - 内存索引（id → ThreadIndexEntry）加速 list 操作
 *   - list 默认按 ID 降序（= 最新在前）
 *   - 单例模式（通过 getInstance）
 *   - 创建 thread 时自动追加到 agents/{agentId}/sessions.jsonl
 */

import fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import * as lockfile from 'proper-lockfile';
import { eventBus } from '@main/common/eventbus';
import { createLogger } from '@main/common/logger';
import { generateSnowflakeId } from '@main/utils/SnowflakeIdGenerator';
import { ThreadEventTypes } from '@shared/events/thread';
import type { ThreadMessageAction, ThreadMessageEventPayload } from '@shared/events/thread';
import { normalizeModelSpec } from '../provider/ModelSpec';
import { createAgentRuntimeLayout, ensureAgentRuntimeLayout } from '../context/AgentRuntimeLayout';
import type {
  ThreadDefinition,
  ThreadIndexEntry,
  ThreadRunStatus,
  CreateThreadParams,
  UpdateThreadParams
} from './types';

const log = createLogger('thread-store');

// ==================== ThreadStore ====================

export class ThreadStore {
  private static instance: ThreadStore | null = null;

  private readonly threadsDir: string;
  constructor(threadsDir: string) {
    this.threadsDir = threadsDir;
  }

  // ==================== 单例 ====================

  static async getInstance(): Promise<ThreadStore> {
    if (!ThreadStore.instance) {
      const { Env } = await import('@main/common/env');
      ThreadStore.instance = new ThreadStore(Env.paths.threadsDir);
    }
    return ThreadStore.instance;
  }

  /** 仅供测试使用 */
  static resetInstance(): void {
    ThreadStore.instance = null;
  }

  // ==================== 初始化 ====================

  /** 确保目录存在 */
  async init(): Promise<void> {
    if (!fs.existsSync(this.threadsDir)) {
      fs.mkdirSync(this.threadsDir, { recursive: true });
    }
    log.info(`[ThreadStore] Initialized: ${this.threadsDir}`);
  }

  // ==================== CRUD ====================

  /** 创建新 Thread（自动生成 Snowflake ID，sessionId = id） */
  async create(params: CreateThreadParams): Promise<ThreadDefinition> {
    await this.init();

    const id = generateSnowflakeId();
    const now = new Date().toISOString();

    const sessionId = id;

    // ✅ 获取 Agent Home 路径
    const { Env } = await import('@main/common/env');
    const agentHomePath = await Env.getAgentHomeDir(params.agentId);

    // ✅ 获取 Agent 名称
    const { AgentStore } = await import('../agents/AgentStore');
    const agentStore = await AgentStore.getInstance();
    const agent = await agentStore.get(params.agentId);
    const agentName = agent?.name;

    const overrideModel = normalizeModelSpec(params.overrideModel);

    const definition: ThreadDefinition = {
      id,
      title: params.title,
      agentId: params.agentId,
      agentName, // ✅ 填充 Agent 名称
      status: 'active',
      sessionId,
      agentMode: params.agentMode ?? 'agent',
      runStatus: 'idle',
      agentHomePath, // ✅ 填充 Agent Home 路径
      createdAt: now,
      updatedAt: now,
      overrideModel,
      runtimeType: params.runtimeType,
      enableThinking: params.enableThinking,
      asrEnabled: params.asrEnabled,
      ttsEnabled: params.ttsEnabled,
      metadata: params.metadata
    };

    await this.writeDefinition(definition);

    // 立即创建 Agent 运行目录结构（project、sessions/{threadId} 等）
    await this.createRuntimeDirectories(definition);

    // P1 重构：移除 dataDirectory 初始化，由 AgentContextResolver 在运行时处理

    // 追加到 agent home 的 sessions.jsonl 索引
    await this.appendToAgentSessionIndex(definition.agentId, {
      id: definition.id,
      createdAt: definition.createdAt
    });

    log.info(`[ThreadStore] Created thread: ${definition.id} (agent: ${definition.agentId})`);
    this.emitThreadMessage('created', toIndexEntry(definition));
    return definition;
  }

  /** 创建 Thread 的 Agent 运行目录 */
  private async createRuntimeDirectories(thread: ThreadDefinition): Promise<void> {
    await ensureAgentRuntimeLayout({
      agentId: thread.agentId,
      sessionId: thread.sessionId,
      agentHomePath: thread.agentHomePath
    });
    log.debug(`[ThreadStore] Created runtime directories for thread ${thread.id}`);
  }

  // P1 重构：已移除 ensureAgentDataDirectory() 方法
  // 路径初始化现在由 AgentContextResolver 在运行时统一处理

  /** 获取 Thread 完整定义 */
  async get(threadId: string): Promise<ThreadDefinition | null> {
    await this.init();

    const filePath = this.getFilePath(threadId);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as ThreadDefinition;
    } catch (err) {
      log.warn(`[ThreadStore] Failed to read thread ${threadId}:`, err);
      return null;
    }
  }

  /** 获取 Thread 列表条目形态（用于 API/事件返回给前端） */
  async getEntry(threadId: string): Promise<ThreadIndexEntry | null> {
    const thread = await this.get(threadId);
    return thread ? toIndexEntry(thread) : null;
  }

  /**
   * 列出所有 Thread（实时读取文件）
   *
   * 默认按 updatedAt 降序（最近更新的在前）。
   * 支持分页、按 agentId 过滤。
   */
  async list(options?: {
    agentId?: string;
    status?: string;
    offset?: number;
    limit?: number;
  }): Promise<ThreadIndexEntry[]> {
    return this.listAsync(options);
  }

  /**
   * 异步列出所有 Thread（批量读取文件）
   *
   * 避免在路由/启动恢复等批量列表场景阻塞主进程事件循环。
   */
  async listAsync(options?: {
    agentId?: string;
    status?: string;
    offset?: number;
    limit?: number;
  }): Promise<ThreadIndexEntry[]> {
    await this.init();

    const files = (await fsp.readdir(this.threadsDir)).filter((f) => f.endsWith('.json'));

    const entries = (
      await Promise.all(
        files.map(async (file) => {
          const thread = await this.readThreadDefinitionFile(file);
          if (!thread) return null;

          if (thread.status === 'deleted') return null;
          if (options?.agentId && thread.agentId !== options.agentId) return null;
          if (options?.status && thread.status !== options.status) return null;

          return toIndexEntry(thread);
        })
      )
    ).filter((entry): entry is ThreadIndexEntry => entry !== null);

    // 按 updatedAt 降序（最近更新的在前）
    entries.sort((a, b) => {
      const timeA = new Date(a.updatedAt).getTime();
      const timeB = new Date(b.updatedAt).getTime();
      return timeB - timeA;
    });

    // 分页
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? entries.length;
    return entries.slice(offset, offset + limit);
  }

  private async readThreadDefinitionFile(file: string): Promise<ThreadDefinition | null> {
    try {
      const filePath = path.join(this.threadsDir, file);
      const raw = await fsp.readFile(filePath, 'utf-8');
      return JSON.parse(raw) as ThreadDefinition;
    } catch (err) {
      log.warn(`[ThreadStore] Failed to read ${file}:`, err);
      return null;
    }
  }

  /**
   * 同步列出所有 Thread（仅保留给测试/迁移期兼容）
   *
   * 新代码应使用 listAsync()。
   */
  listSync(options?: { agentId?: string; status?: string; offset?: number; limit?: number }): ThreadIndexEntry[] {
    if (!fs.existsSync(this.threadsDir)) {
      fs.mkdirSync(this.threadsDir, { recursive: true });
    }

    const files = fs.readdirSync(this.threadsDir).filter((f) => f.endsWith('.json'));
    const entries: ThreadIndexEntry[] = [];

    for (const file of files) {
      try {
        const filePath = path.join(this.threadsDir, file);
        const raw = fs.readFileSync(filePath, 'utf-8');
        const thread = JSON.parse(raw) as ThreadDefinition;

        // 过滤
        if (thread.status === 'deleted') continue;
        if (options?.agentId && thread.agentId !== options.agentId) continue;
        if (options?.status && thread.status !== options.status) continue;

        entries.push(toIndexEntry(thread));
      } catch (err) {
        log.warn(`[ThreadStore] Failed to read ${file}:`, err);
      }
    }

    // 按 updatedAt 降序（最近更新的在前）
    entries.sort((a, b) => {
      const timeA = new Date(a.updatedAt).getTime();
      const timeB = new Date(b.updatedAt).getTime();
      return timeB - timeA;
    });

    // 分页
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? entries.length;
    return entries.slice(offset, offset + limit);
  }

  /** 更新 Thread（部分更新） */
  async update(threadId: string, params: UpdateThreadParams): Promise<ThreadDefinition | null> {
    const existing = await this.get(threadId);
    if (!existing) return null;

    const updated: ThreadDefinition = {
      ...existing,
      ...(params.title !== undefined && { title: params.title }),
      ...(params.status !== undefined && { status: params.status }),
      ...(params.runStatus !== undefined && { runStatus: params.runStatus }),
      ...(params.runtimeType !== undefined && { runtimeType: params.runtimeType }),
      ...(params.enableThinking !== undefined && { enableThinking: params.enableThinking }),
      ...(params.asrEnabled !== undefined && { asrEnabled: params.asrEnabled }),
      ...(params.ttsEnabled !== undefined && { ttsEnabled: params.ttsEnabled }),
      ...(params.metadata !== undefined && { metadata: params.metadata }),
      updatedAt: new Date().toISOString()
    };

    if (params.overrideModel !== undefined) {
      const overrideModel = normalizeModelSpec(params.overrideModel);
      if (overrideModel) {
        updated.overrideModel = overrideModel;
      } else {
        delete updated.overrideModel;
      }
    }

    await this.writeDefinition(updated);

    const prevRunStatus = existing.runStatus;

    log.info(`[ThreadStore] Updated thread: ${threadId}`);

    this.emitThreadMessage(
      'updated',
      toIndexEntry(updated),
      updated.runStatus !== prevRunStatus ? { prevRunStatus } : undefined
    );

    return updated;
  }

  /** 删除 Thread（物理删除文件） */
  async delete(threadId: string): Promise<boolean> {
    await this.init();

    const filePath = this.getFilePath(threadId);
    if (!fs.existsSync(filePath)) return false;

    try {
      fs.unlinkSync(filePath);
      log.info(`[ThreadStore] Deleted thread: ${threadId}`);
      this.emitThreadMessage('deleted', undefined, { threadId });
      return true;
    } catch (err) {
      log.warn(`[ThreadStore] Failed to delete thread ${threadId}:`, err);
      return false;
    }
  }

  /** 检查 Thread 是否存在 */
  async has(threadId: string): Promise<boolean> {
    await this.init();
    const filePath = this.getFilePath(threadId);
    return fs.existsSync(filePath);
  }

  // ==================== 内部方法 ====================

  private getFilePath(threadId: string): string {
    return path.join(this.threadsDir, `${threadId}.json`);
  }

  private async writeDefinition(def: ThreadDefinition): Promise<void> {
    const filePath = this.getFilePath(def.id);

    // 确保父目录存在
    const dirPath = path.dirname(filePath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    // 如果文件不存在，先创建空文件（lockfile 要求）
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '{}', 'utf-8');
    }

    // 获取文件锁，写入，释放锁
    let release: (() => Promise<void>) | null = null;
    try {
      release = await lockfile.lock(filePath, {
        retries: {
          retries: 5,
          minTimeout: 100,
          maxTimeout: 2000
        }
      });

      fs.writeFileSync(filePath, JSON.stringify(def, null, 2), 'utf-8');
    } catch (err) {
      log.error(`[ThreadStore] Failed to write thread ${def.id} with lock:`, err);
      throw err;
    } finally {
      if (release) {
        await release();
      }
    }
  }

  /**
   * 追加到 agent home 的 sessions.jsonl 索引
   *
   * @param agentId Agent ID
   * @param entry Session 索引条目（id + createdAt）
   */
  private async appendToAgentSessionIndex(agentId: string, entry: { id: string; createdAt: string }): Promise<void> {
    try {
      const { Env } = await import('@main/common/env');
      const homeDir = path.join(Env.paths.agentsDir, agentId);

      // 确保 agent home 目录存在
      if (!fs.existsSync(homeDir)) {
        fs.mkdirSync(homeDir, { recursive: true });
      }

      const indexPath = path.join(homeDir, 'sessions.jsonl');
      const line = JSON.stringify(entry) + '\n';

      // 追加模式，线程安全
      fs.appendFileSync(indexPath, line, 'utf-8');

      log.debug(`[ThreadStore] Appended session ${entry.id} to ${agentId}/sessions.jsonl`);
    } catch (err) {
      // 不阻塞主流程，只记录警告
      log.warn(`[ThreadStore] Failed to append to agent session index (${agentId}):`, err);
    }
  }

  private emitThreadMessage(
    action: ThreadMessageAction,
    thread?: ThreadIndexEntry,
    options?: { threadId?: string; prevRunStatus?: ThreadRunStatus }
  ): void {
    const payload: ThreadMessageEventPayload = {
      type: ThreadEventTypes.MESSAGE,
      action,
      threadId: thread?.id ?? options?.threadId ?? '',
      ...(thread && { thread }),
      ...(options?.prevRunStatus && { prevRunStatus: options.prevRunStatus }),
      timestamp: Date.now()
    };

    eventBus.emit(ThreadEventTypes.MESSAGE, payload);
  }
}

// ==================== Thread EventBus 事件类型 ====================

export const ThreadEventType = ThreadEventTypes;
export type ThreadMessageEvent = ThreadMessageEventPayload;

// ==================== 辅助函数 ====================

/** 从完整定义提取索引条目 */
function toIndexEntry(def: ThreadDefinition): ThreadIndexEntry {
  const layout = createAgentRuntimeLayout({
    agentId: def.agentId,
    sessionId: def.sessionId,
    agentHomePath: def.agentHomePath
  });

  return {
    id: def.id,
    title: def.title,
    agentId: def.agentId,
    agentName: def.agentName,
    status: def.status,
    runStatus: def.runStatus ?? 'idle',
    createdAt: def.createdAt,
    updatedAt: def.updatedAt,
    projectPath: layout.agentProjectPath,
    agentProjectPath: layout.agentProjectPath,
    workspacePath: layout.agentProjectPath,
    agentWorkspacePath: layout.agentProjectPath,
    sessionPath: layout.sessionDir,
    agentHomePath: def.agentHomePath,
    overrideModel: def.overrideModel,
    runtimeType: def.runtimeType,
    enableThinking: def.enableThinking,
    asrEnabled: def.asrEnabled,
    ttsEnabled: def.ttsEnabled
  };
}
