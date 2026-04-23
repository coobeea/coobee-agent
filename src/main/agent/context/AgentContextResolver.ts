/**
 * Agent Context Resolver
 *
 * 统一的 Agent 运行期上下文解析器，负责：
 *   - 解析 Agent Home 路径
 *   - 解析数据目录（dataDirectory）
 *   - 解析会话目录（sessionDir）
 *   - 解析有效模型（effectiveModel）
 *   - 验证和规范化工作空间路径
 *
 * 目标：
 *   - 消除 AgentStore、ThreadStore、AgentEnvInjector 中的路径逻辑重复
 *   - 提供统一的路径解析和缓存机制
 *   - 增强安全性（路径验证）
 *
 * @since P1 阶段重构
 */

import path from 'node:path';
import { createLogger } from '@main/common/logger';

const log = createLogger('context-resolver');

// ==================== 类型定义 ====================

/**
 * Agent 运行期上下文
 *
 * 包含 Agent 执行所需的所有路径和配置信息
 */
export interface AgentContext {
  /** Agent ID */
  agentId: string;

  /** Agent 名称 */
  agentName: string;

  /** Agent Home 路径（homes/{agentId}/，跨会话持久化空间） */
  agentHomePath: string;

  /** Agent 专属的数据目录（持久化业务数据） */
  dataDirectory: string;

  /** 工作空间根目录（可选，chat 模式可能为空） */
  workspacePath: string | undefined;

  /** 有效模型（modelOverride || agent.model） */
  effectiveModel: string | undefined;

  /** 会话目录（dataDirectory/sessions/{sessionId}） */
  sessionDir: string;

  /** 会话 ID */
  sessionId: string;
}

/**
 * 上下文解析参数
 */
export interface ResolveParams {
  /** Agent ID（必填） */
  agentId: string;

  /** 会话 ID（必填） */
  sessionId: string;

  /** Thread ID（可选，用于 Thread 恢复场景） */
  threadId?: string;

  /** 工作空间路径（可选，chat 模式可能为空） */
  workspace?: string;

  /** 模型覆盖（可选，Thread 级别的模型覆盖） */
  modelOverride?: string;
}

/**
 * 缓存条目
 */
interface CacheEntry {
  context: AgentContext;
  timestamp: number;
}

// ==================== Agent Context Resolver ====================

/**
 * Agent 运行期上下文解析器
 *
 * 单例模式，提供缓存机制
 */
export class AgentContextResolver {
  private static instance: AgentContextResolver | null = null;

  /** 缓存 Map（key: agentId-sessionId, value: CacheEntry） */
  private cache = new Map<string, CacheEntry>();

  /** 缓存有效期（5 分钟） */
  private readonly CACHE_TTL = 5 * 60 * 1000;

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): AgentContextResolver {
    if (!AgentContextResolver.instance) {
      AgentContextResolver.instance = new AgentContextResolver();
    }
    return AgentContextResolver.instance;
  }

  /**
   * 解析 Agent 运行期上下文
   *
   * @param params 解析参数
   * @returns Agent 上下文
   * @throws 如果 Agent 不存在或参数无效
   */
  async resolve(params: ResolveParams): Promise<AgentContext> {
    // 1. 参数验证
    this.validateParams(params);

    // 2. 检查缓存
    const cacheKey = `${params.agentId}-${params.sessionId}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      log.debug(`[ContextResolver] Cache hit: ${cacheKey}`);
      return cached.context;
    }

    // 3. 加载 Agent 定义
    const { AgentStore } = await import('../agents/AgentStore');
    const store = await AgentStore.getInstance();
    const agent = await store.get(params.agentId);

    if (!agent) {
      throw new Error(`[ContextResolver] Agent not found: ${params.agentId}`);
    }

    // 4. 解析路径
    const { Env } = await import('@main/common/env');
    const { AgentHomeManager } = await import('../agents/AgentHomeManager');

    // 4.1 Agent Home 路径
    let agentHomePath: string;
    try {
      const homeManager = new AgentHomeManager(Env.paths.homesDir);
      agentHomePath = homeManager.initHome(params.agentId);
    } catch (err) {
      log.warn(`[ContextResolver] Failed to initialize Agent Home for ${params.agentId}:`, err);
      // 使用默认路径
      agentHomePath = path.join(Env.paths.homesDir, params.agentId);
    }

    // 4.2 数据目录
    let dataDirectory = agent.metadata?.dataDirectory as string | undefined;
    if (!dataDirectory) {
      // 使用默认路径：.home/data/{agentId}
      dataDirectory = path.join(Env.paths.userHome, 'data', params.agentId);
      log.debug(`[ContextResolver] Using default dataDirectory: ${dataDirectory}`);
    }

    // 4.3 工作空间路径（验证安全性）
    let workspacePath = params.workspace;
    if (workspacePath) {
      // 验证路径安全性（防止路径遍历攻击）
      if (!this.validatePath(Env.paths.userHome, workspacePath)) {
        log.warn(`[ContextResolver] Invalid workspace path: ${workspacePath}`);
        workspacePath = undefined;
      }
    }

    // 4.4 有效模型
    const effectiveModel = this.normalizeModel(params.modelOverride) || agent.model;

    // 4.5 会话目录
    const sessionDir = path.join(dataDirectory, 'sessions', params.sessionId);

    // 5. 构建上下文
    const context: AgentContext = {
      agentId: params.agentId,
      agentName: agent.name,
      agentHomePath,
      dataDirectory,
      workspacePath,
      effectiveModel,
      sessionDir,
      sessionId: params.sessionId
    };

    // 6. 缓存结果
    this.cache.set(cacheKey, {
      context,
      timestamp: Date.now()
    });

    log.debug(
      `[ContextResolver] Resolved context for ${params.agentId}:`,
      JSON.stringify(
        {
          agentName: context.agentName,
          agentHomePath: context.agentHomePath,
          dataDirectory: context.dataDirectory,
          effectiveModel: context.effectiveModel,
          hasWorkspace: !!context.workspacePath
        },
        null,
        2
      )
    );

    return context;
  }

  /**
   * 清理缓存（测试时使用）
   */
  clearCache(): void {
    this.cache.clear();
    log.debug('[ContextResolver] Cache cleared');
  }

  /**
   * 清理过期缓存
   */
  clearExpiredCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp >= this.CACHE_TTL) {
        this.cache.delete(key);
      }
    }
  }

  // ==================== 私有方法 ====================

  /**
   * 验证参数
   */
  private validateParams(params: ResolveParams): void {
    if (!params.agentId || !params.agentId.trim()) {
      throw new Error('[ContextResolver] agentId is required');
    }

    if (!params.sessionId || !params.sessionId.trim()) {
      throw new Error('[ContextResolver] sessionId is required');
    }
  }

  /**
   * 验证路径安全性（防止路径遍历攻击）
   *
   * @param basePath 基础路径（如 userHome）
   * @param targetPath 目标路径
   * @returns 是否安全
   */
  private validatePath(basePath: string, targetPath: string): boolean {
    try {
      const resolved = path.resolve(basePath, targetPath);
      // 确保解析后的路径在基础路径内
      return resolved.startsWith(basePath);
    } catch (err) {
      log.warn('[ContextResolver] Path validation failed:', err);
      return false;
    }
  }

  /**
   * 规范化模型字符串
   *
   * 空字符串视为 undefined
   */
  private normalizeModel(model: string | undefined): string | undefined {
    if (!model || !model.trim()) {
      return undefined;
    }
    return model.trim();
  }
}

// ==================== 导出单例工厂 ====================

/**
 * 获取 AgentContextResolver 单例实例
 */
export function getContextResolver(): AgentContextResolver {
  return AgentContextResolver.getInstance();
}
