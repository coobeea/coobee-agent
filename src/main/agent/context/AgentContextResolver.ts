/**
 * Agent Context Resolver
 *
 * 统一的 Agent 运行期上下文解析器，负责：
 *   - 解析 Agent Home 路径
 *   - 解析会话目录（sessionDir）
 *   - 解析有效模型（effectiveModel）
 *   - 解析 Agent project（工具 cwd）与 session 目录
 *
 * 目标：
 *   - 消除 AgentStore、ThreadStore、AgentEnvInjector 中的路径逻辑重复
 *   - 提供统一的路径解析和缓存机制
 *   - 增强安全性（路径集中管理）
 *
 * @since P1 阶段重构
 */

import { createLogger } from '@main/common/logger';
import { normalizeModelSpec } from '../provider/ModelSpec';
import { ensureAgentRuntimeLayout } from './AgentRuntimeLayout';

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

  /** Agent Home 路径（agents/{agentId}/，跨会话持久化空间） */
  agentHomePath: string;

  /** Agent 业务项目目录，也是工具默认 cwd */
  projectPath: string;

  /** Agent 业务项目目录，也是工具默认 cwd */
  agentProjectPath: string;

  /** @deprecated Use projectPath/agentProjectPath. */
  workspacePath: string;

  /** @deprecated Use projectPath/agentProjectPath. */
  agentWorkspacePath: string;

  /** Agent 私有技能目录 */
  agentSkillsPath: string;

  /** 有效模型（modelOverride || agent.model） */
  effectiveModel: string | undefined;

  /** 会话目录（agent_home/sessions/{sessionId}） */
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

  /** 已废弃：Agent 模式下工作区由 AgentRuntimeLayout 统一决定 */
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

  private constructor() {
    // Enforce singleton creation through getInstance().
  }

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
   * 重置单例实例（主要用于测试隔离）
   */
  static resetInstance(): void {
    AgentContextResolver.instance = null;
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

    // 4.1 Agent 运行目录布局
    const layout = await ensureAgentRuntimeLayout({
      agentId: params.agentId,
      sessionId: params.sessionId
    });
    // 4.4 有效模型
    const effectiveModel = normalizeModelSpec(params.modelOverride) || normalizeModelSpec(agent.model);

    // 5. 构建上下文
    const context: AgentContext = {
      agentId: params.agentId,
      agentName: agent.name,
      agentHomePath: layout.agentHomePath,
      projectPath: layout.agentProjectPath,
      agentProjectPath: layout.agentProjectPath,
      workspacePath: layout.agentProjectPath,
      agentWorkspacePath: layout.agentProjectPath,
      agentSkillsPath: layout.agentSkillsPath,
      effectiveModel,
      sessionDir: layout.sessionDir,
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
          sessionDir: context.sessionDir,
          effectiveModel: context.effectiveModel,
          hasProject: !!context.projectPath
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
}

// ==================== 导出单例工厂 ====================

/**
 * 获取 AgentContextResolver 单例实例
 */
export function getContextResolver(): AgentContextResolver {
  return AgentContextResolver.getInstance();
}
