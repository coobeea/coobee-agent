/**
 * Thread Execution Factory
 *
 * 统一 Thread 执行的 Builder 配置逻辑，消除 ChatRoutes 和 ThreadWaker 的代码重复。
 *
 * 目标：
 *   - 提供统一的 Builder 创建和配置方法
 *   - 确保正常执行和恢复执行使用相同的配置
 *   - 减少维护成本，避免配置不一致
 *
 * @since P1 阶段重构
 */

import { createLogger } from '@main/common/logger';
import type { PiMonoBuilder } from '../runtime/pimono/PiMonoBuilder';
import { AgentContextResolver } from '../context/AgentContextResolver';
import { agentExecutor } from '../AgentExecutor';

// 使用 typeof 获取 AgentExecutor 类型
type AgentExecutor = typeof agentExecutor;

const log = createLogger('execution-factory');

// ==================== 类型定义 ====================

/**
 * Builder 创建参数
 */
export interface CreateBuilderParams {
  /** Thread ID */
  threadId: string;

  /** 会话模式（默认 'file'） */
  sessionMode?: 'file' | 'memory';

  /** 是否为恢复场景（影响日志输出） */
  isResume?: boolean;
}

// ==================== Thread Execution Factory ====================

/**
 * Thread 执行工厂
 *
 * 单例模式，依赖 AgentExecutor 和 AgentContextResolver
 */
export class ThreadExecutionFactory {
  private static instance: ThreadExecutionFactory | null = null;

  private constructor(
    private agentExecutor: AgentExecutor,
    private contextResolver: AgentContextResolver
  ) {}

  /**
   * 获取单例实例
   *
   * @param agentExecutor AgentExecutor 实例
   * @param contextResolver AgentContextResolver 实例（可选，默认使用全局实例）
   */
  static getInstance(agentExecutor: AgentExecutor, contextResolver?: AgentContextResolver): ThreadExecutionFactory {
    if (!ThreadExecutionFactory.instance) {
      ThreadExecutionFactory.instance = new ThreadExecutionFactory(
        agentExecutor,
        contextResolver || AgentContextResolver.getInstance()
      );
    }
    return ThreadExecutionFactory.instance;
  }

  /**
   * 为 Thread 创建配置好的 Builder
   *
   * 统一配置逻辑：
   *   1. 加载 Thread 和 Agent 定义
   *   2. 解析运行期上下文（通过 AgentContextResolver）
   *   3. 配置 Builder（sessionMode, agentId, name, model, instructions）
   *
   * @param params 创建参数
   * @returns 配置好的 PiMonoBuilder
   * @throws 如果 Thread 或 Agent 不存在
   */
  async createBuilder(params: CreateBuilderParams): Promise<PiMonoBuilder> {
    const { threadId, sessionMode = 'file', isResume = false } = params;

    log.debug(`[ExecutionFactory] Creating builder for thread ${threadId} (mode=${sessionMode}, resume=${isResume})`);

    // 1. 加载 Thread 定义
    const { ThreadStore } = await import('../threads/ThreadStore');
    const threadStore = await ThreadStore.getInstance();
    const thread = await threadStore.get(threadId);

    if (!thread) {
      const error = `[ExecutionFactory] Thread not found: ${threadId}`;
      log.error(error);
      throw new Error(error);
    }

    // 2. 加载 Agent 定义
    const { AgentStore } = await import('../agents/AgentStore');
    const agentStore = await AgentStore.getInstance();
    const agent = await agentStore.get(thread.agentId);

    if (!agent) {
      const error = `[ExecutionFactory] Agent not found: ${thread.agentId} (thread: ${threadId})`;
      log.error(error);
      throw new Error(error);
    }

    // 3. 解析运行期上下文（路径、模型等）
    const workspacePath = thread.metadata?.workspacePath as string | undefined;
    const context = await this.contextResolver.resolve({
      agentId: thread.agentId,
      sessionId: threadId,
      threadId,
      workspace: workspacePath,
      modelOverride: thread.overrideModel
    });

    // 4. 创建并配置 Builder
    const builder = this.agentExecutor.piMono().sessionMode(sessionMode).agentId(agent.id).name(agent.id);

    // 5. 应用模型配置
    const modelSpec = context.effectiveModel;
    if (modelSpec) {
      this.agentExecutor.applyProviderConfig(builder, {
        modelOverride: modelSpec,
        sessionId: threadId,
        agentId: agent.id
      });
    }

    // 6. 应用 instructions（包括空字符串，尊重 AgentDefinition 的显式配置）
    if (agent.instructions !== undefined) {
      builder.instructions(agent.instructions);
    }

    log.info(
      `[ExecutionFactory] Builder created for thread ${threadId}:`,
      JSON.stringify(
        {
          agentId: agent.id,
          agentName: agent.name,
          model: modelSpec,
          sessionMode,
          hasInstructions: agent.instructions !== undefined,
          isResume
        },
        null,
        2
      )
    );

    return builder;
  }

  /**
   * 重置单例（测试时使用）
   */
  static resetInstance(): void {
    ThreadExecutionFactory.instance = null;
  }
}

// ==================== 导出单例工厂 ====================

/**
 * 获取 ThreadExecutionFactory 单例实例
 *
 * @param agentExecutor AgentExecutor 实例
 * @param contextResolver AgentContextResolver 实例（可选）
 */
export function getExecutionFactory(
  agentExecutor: AgentExecutor,
  contextResolver?: AgentContextResolver
): ThreadExecutionFactory {
  return ThreadExecutionFactory.getInstance(agentExecutor, contextResolver);
}
