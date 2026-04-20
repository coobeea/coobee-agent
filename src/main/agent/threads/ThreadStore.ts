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
 *   - 创建 thread 时自动追加到 homes/{agentId}/sessions.jsonl
 */

import fs from 'node:fs';
import path from 'node:path';
import * as lockfile from 'proper-lockfile';
import { eventBus } from '@main/common/eventbus';
import { createLogger } from '@main/common/logger';
import { generateSnowflakeId } from '@main/utils/SnowflakeIdGenerator';
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
  private readonly workspacesDir: string;

  /** 内存索引（启动时加载，运行时同步更新） */
  private index = new Map<string, ThreadIndexEntry>();

  /** 是否已初始化 */
  private initialized = false;

  constructor(threadsDir: string, workspacesDir: string) {
    this.threadsDir = threadsDir;
    this.workspacesDir = workspacesDir;
  }

  // ==================== 单例 ====================

  static async getInstance(): Promise<ThreadStore> {
    if (!ThreadStore.instance) {
      const { Env } = await import('@main/common/env');
      ThreadStore.instance = new ThreadStore(Env.paths.threadsDir, Env.paths.workspacesDir);
    }
    return ThreadStore.instance;
  }

  /** 仅供测试使用 */
  static resetInstance(): void {
    ThreadStore.instance = null;
  }

  // ==================== 初始化 ====================

  /** 确保目录存在并加载索引 */
  async init(): Promise<void> {
    if (this.initialized) return;

    if (!fs.existsSync(this.threadsDir)) {
      fs.mkdirSync(this.threadsDir, { recursive: true });
    }

    await this.rebuildIndex();
    this.initialized = true;
    log.info(`[ThreadStore] Initialized: ${this.index.size} threads loaded from ${this.threadsDir}`);
  }

  /** 扫描目录重建索引 */
  private async rebuildIndex(): Promise<void> {
    this.index.clear();
    const files = fs.readdirSync(this.threadsDir).filter((f) => f.endsWith('.json'));

    for (const file of files) {
      try {
        const filePath = path.join(this.threadsDir, file);
        const raw = fs.readFileSync(filePath, 'utf-8');
        const def = JSON.parse(raw) as ThreadDefinition;
        if (def.status !== 'deleted') {
          this.index.set(def.id, toIndexEntry(def, this.workspacesDir));
        }
      } catch (err) {
        log.warn(`[ThreadStore] Failed to load ${file}:`, err);
      }
    }
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

    const definition: ThreadDefinition = {
      id,
      title: params.title,
      agentId: params.agentId,
      status: 'active',
      sessionId,
      agentMode: params.agentMode ?? 'agent',
      agentType: params.agentType ?? 'agent',
      runStatus: 'idle',
      messageCount: 0,
      agentHomePath, // ✅ 填充 Agent Home 路径
      createdAt: now,
      updatedAt: now,
      overrideModel: params.overrideModel,
      metadata: params.metadata
    };

    await this.writeDefinition(definition);
    const entry = toIndexEntry(definition, this.workspacesDir);
    this.index.set(definition.id, entry);

    // 立即创建工作空间目录结构（sessions、contexts、events 等）
    await this.createWorkspaceDirectories(id);

    // 确保智能体的数据目录存在
    await this.ensureAgentDataDirectory(params.agentId);

    // 追加到 agent home 的 sessions.jsonl 索引
    await this.appendToAgentSessionIndex(definition.agentId, {
      id: definition.id,
      createdAt: definition.createdAt
    });

    log.info(`[ThreadStore] Created thread: ${definition.id} (agent: ${definition.agentId})`);
    eventBus.emit(ThreadEventType.CREATED, { thread: entry });
    return definition;
  }

  /** 创建 Thread 的工作空间目录结构 */
  private async createWorkspaceDirectories(threadId: string): Promise<void> {
    try {
      const { Threads } = await import('@main/config/threads');
      // Threads.getWorkspaceDir 会自动创建完整的目录结构：
      // - workspaces/{threadId}/
      // - workspaces/{threadId}/sessions/
      // - workspaces/{threadId}/contexts/
      // - workspaces/{threadId}/events/
      // - workspaces/{threadId}/logs/
      await Threads.getWorkspaceDir(threadId);
      log.debug(`[ThreadStore] Created workspace structure for thread ${threadId}`);
    } catch (err) {
      log.warn(`[ThreadStore] Failed to create workspace directories for thread ${threadId}:`, err);
    }
  }

  /** 确保智能体的数据目录存在 */
  private async ensureAgentDataDirectory(agentId: string): Promise<void> {
    try {
      const { AgentStore } = await import('../agents/AgentStore');
      const { Env } = await import('@main/common/env');
      const store = await AgentStore.getInstance();
      const agent = await store.get(agentId);

      if (!agent) {
        log.warn(`[ThreadStore] Agent not found for dataDirectory check: ${agentId}`);
        return;
      }

      let dataDirectory = agent.metadata?.dataDirectory as string | undefined;

      // 如果智能体没有配置数据目录，自动初始化一个默认的
      if (!dataDirectory) {
        dataDirectory = path.join(Env.paths.userHome, 'data', agentId);

        // 更新 Agent 定义
        await store.update(agentId, {
          metadata: {
            ...agent.metadata,
            dataDirectory
          }
        });

        log.info(`[ThreadStore] Auto-initialized dataDirectory for agent ${agentId}: ${dataDirectory}`);
      }

      // 创建目录（如果不存在）
      if (!fs.existsSync(dataDirectory)) {
        fs.mkdirSync(dataDirectory, { recursive: true });
        log.info(`[ThreadStore] Created dataDirectory: ${dataDirectory}`);
      }
    } catch (err) {
      log.warn(`[ThreadStore] Failed to ensure dataDirectory for agent ${agentId}:`, err);
    }
  }

  /** 获取 Thread 完整定义 */
  async get(threadId: string): Promise<ThreadDefinition | null> {
    await this.init();

    if (!this.index.has(threadId)) return null;

    const filePath = this.getFilePath(threadId);
    if (!fs.existsSync(filePath)) {
      this.index.delete(threadId);
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

  /**
   * 列出所有 Thread（轻量索引）
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
    await this.init();

    let entries = Array.from(this.index.values());

    if (options?.agentId) {
      entries = entries.filter((e) => e.agentId === options.agentId);
    }
    if (options?.status) {
      entries = entries.filter((e) => e.status === options.status);
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
      ...(params.messageCount !== undefined && { messageCount: params.messageCount }),
      ...(params.projectDir !== undefined && { projectDir: params.projectDir ?? undefined }),
      ...(params.overrideModel !== undefined && { overrideModel: params.overrideModel || undefined }),
      ...(params.metadata !== undefined && { metadata: params.metadata }),
      updatedAt: new Date().toISOString()
    };

    await this.writeDefinition(updated);

    const prevRunStatus = existing.runStatus;

    if (updated.status === 'deleted') {
      this.index.delete(threadId);
    } else {
      this.index.set(updated.id, toIndexEntry(updated, this.workspacesDir));
    }

    log.info(`[ThreadStore] Updated thread: ${threadId}`);

    if (updated.runStatus !== prevRunStatus) {
      eventBus.emit(ThreadEventType.STATUS, {
        threadId,
        runStatus: updated.runStatus,
        prevStatus: prevRunStatus
      });
    }
    eventBus.emit(ThreadEventType.UPDATED, {
      thread: toIndexEntry(updated, this.workspacesDir)
    });

    return updated;
  }

  /** 删除 Thread（软删除：标记 status = deleted） */
  async delete(threadId: string): Promise<boolean> {
    await this.init();

    if (!this.index.has(threadId)) return false;

    const filePath = this.getFilePath(threadId);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      this.index.delete(threadId);
      log.info(`[ThreadStore] Deleted thread: ${threadId}`);
      eventBus.emit(ThreadEventType.DELETED, { threadId });
      return true;
    } catch (err) {
      log.warn(`[ThreadStore] Failed to delete thread ${threadId}:`, err);
      return false;
    }
  }

  /** 检查 Thread 是否存在 */
  async has(threadId: string): Promise<boolean> {
    await this.init();
    return this.index.has(threadId);
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
      const homeDir = path.join(Env.paths.homesDir, agentId);

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
}

// ==================== Thread EventBus 事件类型 ====================

export const ThreadEventType = {
  CREATED: 'thread:created',
  UPDATED: 'thread:updated',
  DELETED: 'thread:deleted',
  STATUS: 'thread:status'
} as const;

export interface ThreadCreatedEvent {
  thread: ThreadIndexEntry;
}
export interface ThreadUpdatedEvent {
  thread: ThreadIndexEntry;
}
export interface ThreadDeletedEvent {
  threadId: string;
}
export interface ThreadStatusEvent {
  threadId: string;
  runStatus: ThreadRunStatus;
  prevStatus: ThreadRunStatus;
}

// ==================== 辅助函数 ====================

/** 从完整定义提取索引条目 */
function toIndexEntry(def: ThreadDefinition, workspacesDir: string): ThreadIndexEntry {
  // 修正旧的 homes 路径到新的 agents 路径
  let agentHomePath = def.agentHomePath;
  if (agentHomePath && agentHomePath.includes('/homes/')) {
    agentHomePath = agentHomePath.replace('/homes/', '/agents/');
  }

  return {
    id: def.id,
    title: def.title,
    agentId: def.agentId,
    status: def.status,
    runStatus: def.runStatus ?? 'idle',
    agentType: def.agentType ?? 'agent',
    messageCount: def.messageCount,
    createdAt: def.createdAt,
    updatedAt: def.updatedAt,
    workspacePath: path.join(workspacesDir, def.id),
    agentHomePath,
    projectDir: def.projectDir,
    overrideModel: def.overrideModel
  };
}
