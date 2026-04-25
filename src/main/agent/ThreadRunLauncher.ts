import { createLogger } from '@main/common/logger';

import { agentExecutor } from './AgentExecutor';
import { AgentContextResolver } from './context/AgentContextResolver';
import { RuntimeBuilderFactory, type RuntimeBuilder } from './runtime/RuntimeBuilderFactory';
import type { ExecutionResult, StreamChunk } from './runtime/types';

const log = createLogger('thread-run-launcher');

type AgentExecutorInstance = typeof agentExecutor;
type ThreadRunBuilderFactory = Pick<RuntimeBuilderFactory, 'create'>;

export interface ThreadRunParams {
  /** Thread ID，同时也是 sessionId */
  threadId: string;
  /** 本次运行的输入消息 */
  message: string;
}

/**
 * Thread Run Launcher
 *
 * 统一封装 Thread 长会话执行的启动方式：
 *   - start(): 后台提交（RPC / 恢复场景）
 *   - stream(): 流式执行（SSE 场景）
 *   - resume(): 带恢复语义的后台提交
 *
 * 当前只负责收敛入口层对 Builder / AgentExecutor 的直接拼装，
 * 不接管错误码映射，也不修改 ThreadStore 状态机。
 */
export class ThreadRunLauncher {
  private static instance: ThreadRunLauncher | null = null;

  constructor(
    private readonly executor: AgentExecutorInstance,
    private readonly contextResolver: AgentContextResolver,
    private readonly builderFactory: ThreadRunBuilderFactory
  ) {}

  static getInstance(
    executor: AgentExecutorInstance = agentExecutor,
    contextResolver?: AgentContextResolver,
    builderFactory?: ThreadRunBuilderFactory
  ): ThreadRunLauncher {
    if (!ThreadRunLauncher.instance) {
      ThreadRunLauncher.instance = new ThreadRunLauncher(
        executor,
        contextResolver || AgentContextResolver.getInstance(),
        builderFactory || RuntimeBuilderFactory.getInstance()
      );
    }
    return ThreadRunLauncher.instance;
  }

  static resetInstance(): void {
    ThreadRunLauncher.instance = null;
  }

  async start(params: ThreadRunParams): Promise<ReturnType<AgentExecutorInstance['submit']>> {
    const request = await this.createRequest(params, false);
    log.debug(`[ThreadRunLauncher] start thread=${params.threadId}`);
    return this.executor.submit(request);
  }

  async resume(params: ThreadRunParams): Promise<ReturnType<AgentExecutorInstance['submit']>> {
    const request = await this.createRequest(params, true);
    log.debug(`[ThreadRunLauncher] resume thread=${params.threadId}`);
    return this.executor.submit(request);
  }

  async *stream(params: ThreadRunParams): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
    const request = await this.createRequest(params, false);
    log.debug(`[ThreadRunLauncher] stream thread=${params.threadId}`);
    return yield* this.executor.stream(request);
  }

  private async createRequest(
    params: ThreadRunParams,
    isResume: boolean
  ): Promise<{ sessionId: string; message: string; builder: RuntimeBuilder }> {
    const builder = await this.createBuilder(params.threadId, isResume);

    return {
      sessionId: params.threadId,
      message: params.message,
      builder
    };
  }

  private async createBuilder(threadId: string, isResume: boolean): Promise<RuntimeBuilder> {
    const { ThreadStore } = await import('./threads/ThreadStore');
    const threadStore = await ThreadStore.getInstance();
    const thread = await threadStore.get(threadId);

    if (!thread) {
      const error = `[ThreadRunLauncher] Thread not found: ${threadId}`;
      log.error(error);
      throw new Error(error);
    }

    const { AgentStore } = await import('./agents/AgentStore');
    const agentStore = await AgentStore.getInstance();
    const agent = await agentStore.get(thread.agentId);

    if (!agent) {
      const error = `[ThreadRunLauncher] Agent not found: ${thread.agentId} (thread: ${threadId})`;
      log.error(error);
      throw new Error(error);
    }

    const workspacePath = thread.metadata?.workspacePath as string | undefined;
    const context = await this.contextResolver.resolve({
      agentId: thread.agentId,
      sessionId: threadId,
      threadId,
      workspace: workspacePath,
      modelOverride: thread.overrideModel
    });

    const builder = this.builderFactory.create({
      mode: thread.agentMode,
      persistence: 'thread',
      sessionId: threadId,
      agentId: agent.id,
      name: agent.id,
      instructions: agent.instructions,
      modelOverride: context.effectiveModel
    });

    log.info(
      `[ThreadRunLauncher] Builder created for thread ${threadId}:`,
      JSON.stringify(
        {
          agentId: agent.id,
          agentName: agent.name,
          model: context.effectiveModel,
          runtime: builder.constructor.name,
          hasInstructions: agent.instructions !== undefined,
          isResume
        },
        null,
        2
      )
    );

    return builder;
  }
}
