import { describe, expect, it, vi } from 'vitest';
import { ThreadExecutor } from '../../ThreadExecutor';
import type { AgentExecuteRequest } from '../../AgentExecutor';
import type { AgentExecutionResult, AgentStreamChunk } from '../../runtime/types';

function makeRequest(overrides: Partial<AgentExecuteRequest> = {}): AgentExecuteRequest {
  return {
    sessionId: 'thread-1',
    message: 'hello',
    runtimeType: 'pi-mono',
    sessionMode: 'file',
    ...overrides
  };
}

describe('ThreadExecutor', () => {
  it('stream 只接收 threadId/message，并委托底层 AgentExecutor.stream', async () => {
    const request = makeRequest();
    const mockFactory = { createRequest: vi.fn(async () => request) };
    const mockStream = vi.fn(async function* (): AsyncGenerator<AgentStreamChunk, AgentExecutionResult, unknown> {
      yield { type: 'text:delta', content: 'hi' };
      return { output: 'hi' };
    });

    vi.mock('../../execution/ThreadExecutionFactory', () => ({
      ThreadExecutionFactory: { getInstance: () => mockFactory }
    }));
    vi.mock('../../AgentExecutor', () => ({
      agentExecutor: { stream: mockStream, submit: vi.fn(), abort: vi.fn(), getStatus: vi.fn() }
    }));

    const gen = ThreadExecutor.stream('thread-1', 'hello');
    const first = await gen.next();
    const done = await gen.next();

    expect(first.value).toMatchObject({ type: 'text:delta', content: 'hi' });
    expect(done.value).toMatchObject({ output: 'hi' });
    expect(mockFactory.createRequest).toHaveBeenCalledWith({
      threadId: 'thread-1',
      message: 'hello',
      runtimeType: 'pi-mono'
    });
    expect(mockStream).toHaveBeenCalledWith(request);
  });
});
