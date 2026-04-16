/**
 * Agent 定义持久化存储
 *
 * 提供 CRUD 操作，启动时扫描目录加载索引。
 *
 * 设计：
 *   - 每个 Agent 包含：
 *     1. 索引文件（{agentId}.json）：基本信息
 *     2. 工作空间目录（.home/agents/{agentId}/）：人格文件、记忆、技能等
 *   - 内存索引（id → AgentIndexEntry）加速 list 操作
 *   - 全量读取按需（get 时才读文件）
 *   - 单例模式
 */

import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '@main/common/logger';
import { Env } from '@main/common/env';
import { AgentHomeManager } from './AgentHomeManager';
import type {
  AgentDefinition,
  AgentIndexEntry,
  CreateAgentParams,
  UpdateAgentParams
} from './types';

const log = createLogger('agent-store');

/** 将完整定义转为索引条目 */
function toIndexEntry(def: AgentDefinition, homeManager: AgentHomeManager): AgentIndexEntry {
  const agentHomePath = homeManager.getHomePath(def.id);
  const workspacePath = path.join(agentHomePath, 'workspace');
  
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    createdBy: def.createdBy,
    version: def.version,
    updatedAt: def.updatedAt,
    skills: def.skills,
    model: def.model,
    agentHomePath,
    workspacePath
  };
}

export class AgentStore {
  private static instance: AgentStore | null = null;

  private readonly userDir: string;
  private readonly homeManager: AgentHomeManager;

  /** 内存索引（启动时加载，运行时同步更新） */
  private index = new Map<string, AgentIndexEntry>();

  /** 是否已初始化 */
  private initialized = false;

  constructor(userDir: string, homesDir?: string) {
    this.userDir = userDir;
    // 工作空间目录默认为 .home/agents/
    const effectiveHomesDir = homesDir || path.join(Env.paths.userHome, 'agents');
    this.homeManager = new AgentHomeManager(effectiveHomesDir);
  }

  // ==================== 单例 ====================

  static getInstance(): AgentStore {
    if (!AgentStore.instance) {
      AgentStore.instance = new AgentStore(Env.paths.userAgentsDir);
    }
    return AgentStore.instance;
  }

  /** 仅供测试使用 */
  static resetInstance(): void {
    AgentStore.instance = null;
  }

  // ==================== 初始化 ====================

  /** 确保目录存在并加载索引 */
  async init(): Promise<void> {
    if (this.initialized) return;

    // 确保目录存在
    if (!fs.existsSync(this.userDir)) {
      fs.mkdirSync(this.userDir, { recursive: true });
    }

    // 扫描目录加载索引
    await this.rebuildIndex();

    this.initialized = true;
    log.info(`[AgentStore] Initialized: ${this.index.size} agents loaded (${this.userDir})`);
  }

  /** 扫描目录重建索引 */
  private async rebuildIndex(): Promise<void> {
    this.index.clear();

    if (fs.existsSync(this.userDir)) {
      const files = fs.readdirSync(this.userDir).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        try {
          const filePath = path.join(this.userDir, file);
          const raw = fs.readFileSync(filePath, 'utf-8');
          const def = JSON.parse(raw) as AgentDefinition;
          this.index.set(def.id, toIndexEntry(def, this.homeManager));
        } catch (err) {
          log.warn(`[AgentStore] Failed to load ${file}:`, err);
        }
      }
    }
  }

  // ==================== CRUD ====================

  /** 创建新 Agent */
  async create(params: CreateAgentParams): Promise<AgentDefinition> {
    await this.init();

    log.debug('[AgentStore] Creating agent:', {
      id: params.id,
      name: params.name,
      descriptionLength: params.description.length,
      instructionsLength: params.instructions?.length || 0
    });

    // 校验 ID 唯一性
    if (this.index.has(params.id)) {
      log.warn('[AgentStore] Agent ID already exists:', params.id);
      throw new Error(`Agent "${params.id}" already exists`);
    }

    // 校验 ID 格式（kebab-case）
    if (!/^[a-z0-9_][a-z0-9-_]*[a-z0-9_]$/.test(params.id) && !/^[a-z0-9_]$/.test(params.id)) {
      log.warn('[AgentStore] Invalid agent ID format:', params.id);
      throw new Error(
        `Invalid agent ID "${params.id}". Must be kebab-case (lowercase letters, numbers, hyphens, underscores).`
      );
    }

    const now = new Date().toISOString();

    const definition: AgentDefinition = {
      id: params.id,
      name: params.name,
      description: params.description,
      instructions: params.instructions || '', // 初始化为空，用户将在工作空间中填写
      excludeTools: params.excludeTools,
      skills: params.skills,
      model: params.model,
      createdAt: now,
      updatedAt: now,
      createdBy: params.createdBy ?? 'user',
      version: 1,
      metadata: params.metadata
    };

    // 1. 创建工作空间
    this.homeManager.initHome(params.id);

    // 2. 如果提供了 instructions，写入 SOUL.md
    if (params.instructions) {
      this.homeManager.writeFile(params.id, 'SOUL.md', params.instructions);
    }

    // 3. 写入基本定义文件
    this.writeDefinition(definition);

    // 4. 更新索引
    this.index.set(definition.id, toIndexEntry(definition, this.homeManager));

    log.info(`[AgentStore] Created agent: ${definition.id} (v${definition.version})`);
    return definition;
  }

  /** 获取 Agent 完整定义 */
  async get(agentId: string): Promise<AgentDefinition | null> {
    await this.init();

    if (!this.index.has(agentId)) return null;

    const filePath = path.join(this.userDir, `${agentId}.json`);
    if (!fs.existsSync(filePath)) {
      this.index.delete(agentId);
      return null;
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as AgentDefinition;
    } catch (err) {
      log.warn(`[AgentStore] Failed to read agent ${agentId}:`, err);
      return null;
    }
  }

  /** 列出所有 Agent（轻量索引） */
  async list(): Promise<AgentIndexEntry[]> {
    await this.init();
    return Array.from(this.index.values());
  }

  /** 更新 Agent 定义（部分更新，版本号自动递增） */
  async update(agentId: string, params: UpdateAgentParams): Promise<AgentDefinition | null> {
    const existing = await this.get(agentId);
    if (!existing) return null;

    const updated: AgentDefinition = {
      ...existing,
      ...(params.name !== undefined && { name: params.name }),
      ...(params.description !== undefined && { description: params.description }),
      ...(params.instructions !== undefined && { instructions: params.instructions }),
      ...(params.excludeTools !== undefined && { excludeTools: params.excludeTools }),
      ...(params.skills !== undefined && { skills: params.skills }),
      ...(params.model !== undefined && { model: params.model }),
      ...(params.metadata !== undefined && { metadata: params.metadata }),
      updatedAt: new Date().toISOString(),
      version: existing.version + 1
    };

    // 写文件
    this.writeDefinition(updated);

    // 更新索引
    this.index.set(updated.id, toIndexEntry(updated, this.homeManager));

    log.info(`[AgentStore] Updated agent: ${agentId} (v${updated.version})`);
    return updated;
  }

  /** 删除 Agent */
  async delete(agentId: string): Promise<boolean> {
    await this.init();

    if (!this.index.has(agentId)) return false;

    const filePath = path.join(this.userDir, `${agentId}.json`);
    try {
      // 1. 删除定义文件
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      // 2. 删除工作空间目录
      this.homeManager.deleteHome(agentId);

      // 3. 更新索引
      this.index.delete(agentId);

      log.info(`[AgentStore] Deleted agent: ${agentId}`);
      return true;
    } catch (err) {
      log.warn(`[AgentStore] Failed to delete agent ${agentId}:`, err);
      return false;
    }
  }

  /** 检查 Agent 是否存在 */
  async has(agentId: string): Promise<boolean> {
    await this.init();
    return this.index.has(agentId);
  }

  // ==================== 工作空间管理 ====================

  /** 获取 AgentHomeManager 实例 */
  getHomeManager(): AgentHomeManager {
    return this.homeManager;
  }

  /** 读取 Agent 的所有人格文件 */
  async getPersonalityFiles(agentId: string): Promise<Record<string, string>> {
    await this.init();
    if (!this.index.has(agentId)) {
      throw new Error(`Agent "${agentId}" not found`);
    }
    return this.homeManager.readAllFiles(agentId);
  }

  /** 更新 Agent 的人格文件 */
  async updatePersonalityFile(agentId: string, fileName: string, content: string): Promise<void> {
    await this.init();
    if (!this.index.has(agentId)) {
      throw new Error(`Agent "${agentId}" not found`);
    }
    this.homeManager.writeFile(agentId, fileName, content);

    // 如果是 SOUL.md，同步更新 instructions 字段
    if (fileName === 'SOUL.md') {
      const existing = await this.get(agentId);
      if (existing) {
        existing.instructions = content;
        existing.updatedAt = new Date().toISOString();
        existing.version += 1;
        this.writeDefinition(existing);
        this.index.set(existing.id, toIndexEntry(existing, this.homeManager));
      }
    }
  }

  // ==================== 内部方法 ====================

  /** 写入 Agent 定义 */
  private writeDefinition(def: AgentDefinition): void {
    const filePath = path.join(this.userDir, `${def.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(def, null, 2), 'utf-8');
  }
}
