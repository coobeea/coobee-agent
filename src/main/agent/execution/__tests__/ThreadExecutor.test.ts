import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThreadExecutor } from '../../ThreadExecutor';
import type { AgentExecuteRequest } from '../../AgentExecutor';
import type { AgentExecutionResult, AgentStreamChunk } from '../../runtime/types';

const mocks = vi.hoisted(() => ({
  createRequest: vi.fn(),
  stream: vi.fn(),
  submit: vi.fn(),
  abort: vi.fn(),
  getStatus: vi.fn()
}));

vi.mock('../../execution/ThreadExecutionFactory', () => ({
  ThreadExecutionFactory: { getInstance: () => ({ createRequest: mocks.createRequest }) }
}));

vi.mock('../../AgentExecutor', () => ({
  agentExecutor: {
    stream: mocks.stream,
    submit: mocks.submit,
    abort: mocks.abort,
    getStatus: mocks.getStatus
  }
}));

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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stream 只接收 threadId/message，并委托底层 AgentExecutor.stream', async () => {
    const request = makeRequest();
    mocks.createRequest.mockResolvedValue(request);
    mocks.stream.mockImplementation(async function* (): AsyncGenerator<
      AgentStreamChunk,
      AgentExecutionResult,
      unknown
    > {
      yield { type: 'text:delta', content: 'hi' };
      return { output: 'hi' };
    });

    const gen = ThreadExecutor.stream('thread-1', 'hello');
    const first = await gen.next();
    const done = await gen.next();

    expect(first.value).toMatchObject({ type: 'text:delta', content: 'hi' });
    expect(done.value).toMatchObject({ output: 'hi' });
    expect(mocks.createRequest).toHaveBeenCalledWith({
      threadId: 'thread-1',
      message: 'hello'
    });
    expect(mocks.stream).toHaveBeenCalledWith(request);
  });

  it('显式传入 runtimeType 时透传给请求工厂', async () => {
    const request = makeRequest({ runtimeType: 'openai' });
    mocks.createRequest.mockResolvedValue(request);
    mocks.stream.mockImplementation(async function* (): AsyncGenerator<
      AgentStreamChunk,
      AgentExecutionResult,
      unknown
    > {
      yield { type: 'text:delta', content: 'ok' };
      return { output: 'ok' };
    });

    const gen = ThreadExecutor.stream('thread-1', 'hello', 'openai');
    await gen.next();

    expect(mocks.createRequest).toHaveBeenCalledWith({
      threadId: 'thread-1',
      message: 'hello',
      runtimeType: 'openai'
    });
  });
});
