import { agentExecutor } from './AgentExecutor';
import type { AgentRuntimeKind, AgentStreamChunk, AgentExecutionResult } from './runtime/types';
import { ThreadExecutionFactory } from './execution/ThreadExecutionFactory';

export interface ThreadMessageParams {
  threadId: string;
  message: string;
  runtimeType?: AgentRuntimeKind;
}

/**
 * Thread 场景的对外执行门面（全静态方法）。
 *
 * 外部调用方只传 threadId 和 message；Thread/Agent/模型/workspace 的装配
 * 由 ThreadExecutionFactory 完成，真正执行仍委托给底层 AgentExecutor。
 *
 * 用法：
 *   import { ThreadExecutor } from '@main/agent/ThreadExecutor';
 *   ThreadExecutor.submit(threadId, message);
 *   ThreadExecutor.abort(threadId);
 */
export class ThreadExecutor {
  private constructor() {
    // 工具类，不允许实例化
  }

  static async *stream(
    threadId: string,
    message: string,
    runtimeType?: AgentRuntimeKind
  ): AsyncGenerator<AgentStreamChunk, AgentExecutionResult, unknown> {
    const params: ThreadMessageParams = { threadId, message };
    if (runtimeType !== undefined) {
      params.runtimeType = runtimeType;
    }
    const request = await ThreadExecutionFactory.getInstance().createRequest(params);
    return yield* agentExecutor.stream(request);
  }

  static async submit(
    threadId: string,
    message: string,
    runtimeType?: AgentRuntimeKind
  ): Promise<{ status: 'accepted'; sessionId: string } | { status: 'busy'; sessionId: string }> {
    const params: ThreadMessageParams = { threadId, message };
    if (runtimeType !== undefined) {
      params.runtimeType = runtimeType;
    }
    const request = await ThreadExecutionFactory.getInstance().createRequest(params);
    return agentExecutor.submit(request);
  }

  static async *streamMessage(
    params: ThreadMessageParams
  ): AsyncGenerator<AgentStreamChunk, AgentExecutionResult, unknown> {
    return yield* ThreadExecutor.stream(params.threadId, params.message, params.runtimeType);
  }

  static submitMessage(
    params: ThreadMessageParams
  ): Promise<{ status: 'accepted'; sessionId: string } | { status: 'busy'; sessionId: string }> {
    return ThreadExecutor.submit(params.threadId, params.message, params.runtimeType);
  }

  static abort(threadId: string): boolean {
    return agentExecutor.abort(threadId);
  }

  static getStatus(threadId: string): { busy: boolean; startedAt?: number } {
    return agentExecutor.getStatus(threadId);
  }
}
