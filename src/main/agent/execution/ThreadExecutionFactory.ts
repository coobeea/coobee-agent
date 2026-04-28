import type { AgentExecuteRequest } from '../AgentExecutor';
import type { AgentRuntimeKind } from '../runtime/types';

export interface CreateThreadExecutionRequestParams {
  threadId: string;
  message: string;
  runtimeType?: AgentRuntimeKind;
}

/**
 * Thread 执行请求工厂。
 *
 * 对外调用方只需要提供 threadId 和 message；Thread、Agent、模型、
 * workspace 等装配细节统一收口在这里，避免散落到路由、RPC、恢复任务里。
 */
export class ThreadExecutionFactory {
  private static instance: ThreadExecutionFactory | null = null;

  static getInstance(): ThreadExecutionFactory {
    if (!ThreadExecutionFactory.instance) {
      ThreadExecutionFactory.instance = new ThreadExecutionFactory();
    }
    return ThreadExecutionFactory.instance;
  }

  static resetInstance(): void {
    ThreadExecutionFactory.instance = null;
  }

  async createRequest(params: CreateThreadExecutionRequestParams): Promise<AgentExecuteRequest> {
    const { ThreadStore } = await import('../threads/ThreadStore');
    const { AgentStore } = await import('../agents/AgentStore');

    const threadStore = await ThreadStore.getInstance();
    const thread = await threadStore.get(params.threadId);
    if (!thread) {
      throw new Error(`Thread ${params.threadId} not found`);
    }

    const agentStore = AgentStore.getInstance();
    const agent = await agentStore.get(thread.agentId);
    if (!agent) {
      throw new Error(`Agent ${thread.agentId} not found`);
    }

    return {
      sessionId: thread.id,
      message: params.message,
      agentId: agent.id,
      instructions: agent.instructions,
      modelOverride: thread.overrideModel || agent.model,
      workspaceRoot: thread.metadata?.workspacePath as string | undefined,
      mode: thread.agentMode ?? 'agent',
      runtimeType: params.runtimeType ?? 'pi-mono',
      sessionMode: 'file'
    };
  }
}
