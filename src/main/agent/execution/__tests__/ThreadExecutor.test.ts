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
    const factory = {
      createRequest: vi.fn(async () => request)
    };
    const executor = {
      stream: vi.fn(async function* (): AsyncGenerator<AgentStreamChunk, AgentExecutionResult, unknown> {
        yield { type: 'text:delta', content: 'hi' };
        return { output: 'hi' };
      }),
      submit: vi.fn(),
      abort: vi.fn(),
      getStatus: vi.fn()
    };

    const threadExecutor = new ThreadExecutor(factory, executor);
    const gen = threadExecutor.stream('thread-1', 'hello');
    const first = await gen.next();
    const done = await gen.next();

    expect(first.value).toMatchObject({ type: 'text:delta', content: 'hi' });
    expect(done.value).toMatchObject({ output: 'hi' });
    expect(factory.createRequest).toHaveBeenCalledWith({
      threadId: 'thread-1',
      message: 'hello',
      runtimeType: 'pi-mono'
    });
    expect(executor.stream).toHaveBeenCalledWith(request);
  });

  it('submit 只接收 threadId/message，并委托底层 AgentExecutor.submit', async () => {
    const request = makeRequest();
    const factory = {
      createRequest: vi.fn(async () => request)
    };
    const executor = {
      stream: vi.fn(),
      submit: vi.fn(() => ({ status: 'accepted' as const, sessionId: 'thread-1' })),
      abort: vi.fn(),
      getStatus: vi.fn()
    };

    const threadExecutor = new ThreadExecutor(factory, executor);
    const result = await threadExecutor.submit('thread-1', 'hello');

    expect(result).toEqual({ status: 'accepted', sessionId: 'thread-1' });
    expect(factory.createRequest).toHaveBeenCalledWith({
      threadId: 'thread-1',
      message: 'hello',
      runtimeType: 'pi-mono'
    });
    expect(executor.submit).toHaveBeenCalledWith(request);
  });
});
