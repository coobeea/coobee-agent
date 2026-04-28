import { agentExecutor } from './AgentExecutor';
import type { AgentExecuteRequest } from './AgentExecutor';
import type { AgentExecutionResult, AgentRuntimeKind, AgentStreamChunk } from './runtime/types';
import { ThreadExecutionFactory } from './execution/ThreadExecutionFactory';

export interface ThreadMessageParams {
  threadId: string;
  message: string;
  runtimeType?: AgentRuntimeKind;
}

interface ThreadExecutionRequestFactory {
  createRequest(params: ThreadMessageParams): Promise<AgentExecuteRequest>;
}

interface AgentRequestExecutor {
  stream(request: AgentExecuteRequest): AsyncGenerator<AgentStreamChunk, AgentExecutionResult, unknown>;
  submit(
    request: AgentExecuteRequest
  ): { status: 'accepted'; sessionId: string } | { status: 'busy'; sessionId: string };
  abort(sessionId: string): boolean;
  getStatus(sessionId: string): { busy: boolean; startedAt?: number };
}

/**
 * Thread 场景的对外执行门面。
 *
 * 外部调用方只传 threadId 和 message；Thread/Agent/模型/workspace 的装配
 * 由 ThreadExecutionFactory 完成，真正执行仍委托给底层 AgentExecutor。
 */
export class ThreadExecutor {
  constructor(
    private readonly executionFactory: ThreadExecutionRequestFactory = ThreadExecutionFactory.getInstance(),
    private readonly executor: AgentRequestExecutor = agentExecutor
  ) {}

  async *stream(
    threadId: string,
    message: string,
    runtimeType: AgentRuntimeKind = 'pi-mono'
  ): AsyncGenerator<AgentStreamChunk, AgentExecutionResult, unknown> {
    const request = await this.executionFactory.createRequest({ threadId, message, runtimeType });
    return yield* this.executor.stream(request);
  }

  async submit(
    threadId: string,
    message: string,
    runtimeType: AgentRuntimeKind = 'pi-mono'
  ): Promise<{ status: 'accepted'; sessionId: string } | { status: 'busy'; sessionId: string }> {
    const request = await this.executionFactory.createRequest({ threadId, message, runtimeType });
    return this.executor.submit(request);
  }

  async *streamMessage(params: ThreadMessageParams): AsyncGenerator<AgentStreamChunk, AgentExecutionResult, unknown> {
    return yield* this.stream(params.threadId, params.message, params.runtimeType);
  }

  submitMessage(
    params: ThreadMessageParams
  ): Promise<{ status: 'accepted'; sessionId: string } | { status: 'busy'; sessionId: string }> {
    return this.submit(params.threadId, params.message, params.runtimeType);
  }

  abort(threadId: string): boolean {
    return this.executor.abort(threadId);
  }

  getStatus(threadId: string): { busy: boolean; startedAt?: number } {
    return this.executor.getStatus(threadId);
  }
}

export const threadExecutor = new ThreadExecutor();
