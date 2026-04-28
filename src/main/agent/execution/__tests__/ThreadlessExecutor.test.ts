import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ThreadlessExecutor } from '../../ThreadlessExecutor';
import type { AgentExecutionResult, AgentStreamChunk } from '../../runtime/types';

const mocks = vi.hoisted(() => ({
  stream: vi.fn(),
  getAgent: vi.fn(),
  generateSnowflakeId: vi.fn(() => 'snowflake-1')
}));

vi.mock('../../AgentExecutor', () => ({
  agentExecutor: { stream: mocks.stream }
}));

vi.mock('../../agents/AgentStore', () => ({
  AgentStore: {
    getInstance: vi.fn(() => ({
      get: mocks.getAgent
    }))
  }
}));

vi.mock('../../../utils/SnowflakeIdGenerator', () => ({
  generateSnowflakeId: mocks.generateSnowflakeId
}));

function mockStream(chunks: AgentStreamChunk[], result: AgentExecutionResult = { output: '' }): void {
  mocks.stream.mockImplementation(async function* (): AsyncGenerator<AgentStreamChunk, AgentExecutionResult, unknown> {
    for (const chunk of chunks) {
      yield chunk;
    }
    return result;
  });
}

describe('ThreadlessExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateSnowflakeId.mockReturnValue('snowflake-1');
    mocks.getAgent.mockResolvedValue({
      id: 'agent-1',
      instructions: 'You are helpful',
      model: 'openai/gpt-4.1'
    });
  });

  it('stream 只接收 agentId/message，并委托底层 AgentExecutor.stream', async () => {
    mockStream([{ type: 'text:delta', content: 'hi' }], { output: 'hi' });

    const gen = ThreadlessExecutor.stream('agent-1', 'hello');
    const first = await gen.next();
    const done = await gen.next();

    expect(first.value).toMatchObject({ type: 'text:delta', content: 'hi' });
    expect(done.value).toMatchObject({ output: 'hi' });
    expect(mocks.stream).toHaveBeenCalledWith({
      sessionId: 'threadless-agent-agent-1-snowflake-1',
      message: 'hello',
      agentId: 'agent-1',
      lightweight: true,
      mode: 'chat',
      runtimeType: 'pi-mono',
      sessionMode: 'memory',
      maxTurns: 1,
      instructions: 'You are helpful',
      modelOverride: 'openai/gpt-4.1'
    });
  });

  it('run 消费 text:delta 并返回完整文本', async () => {
    mockStream([
      { type: 'text:delta', content: 'hello' },
      { type: 'reasoning:delta', content: 'hidden' },
      { type: 'text:delta', content: ' world' }
    ]);

    await expect(ThreadlessExecutor.run('agent-1', 'hello')).resolves.toBe('hello world');
  });
});
