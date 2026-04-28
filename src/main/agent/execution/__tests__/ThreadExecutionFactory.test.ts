import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThreadExecutionFactory } from '../ThreadExecutionFactory';

const threadGet = vi.fn();
const agentGet = vi.fn();

vi.mock('../../threads/ThreadStore', () => ({
  ThreadStore: {
    getInstance: vi.fn(async () => ({
      get: threadGet
    }))
  }
}));

vi.mock('../../agents/AgentStore', () => ({
  AgentStore: {
    getInstance: vi.fn(() => ({
      get: agentGet
    }))
  }
}));

describe('ThreadExecutionFactory', () => {
  beforeEach(() => {
    threadGet.mockReset();
    agentGet.mockReset();
  });

  it('根据 threadId 和 message 生成标准 AgentExecuteRequest', async () => {
    threadGet.mockResolvedValue({
      id: 'thread-1',
      agentId: 'agent-1',
      agentMode: 'agent',
      overrideModel: 'provider/model-a',
      metadata: { workspacePath: '/tmp/workspace-a' }
    });
    agentGet.mockResolvedValue({
      id: 'agent-1',
      instructions: 'system prompt',
      model: 'provider/model-b'
    });

    const request = await new ThreadExecutionFactory().createRequest({
      threadId: 'thread-1',
      message: 'hello'
    });

    expect(request).toMatchObject({
      sessionId: 'thread-1',
      message: 'hello',
      agentId: 'agent-1',
      instructions: 'system prompt',
      modelOverride: 'provider/model-a',
      workspaceRoot: '/tmp/workspace-a',
      mode: 'agent',
      runtimeType: 'pi-mono',
      sessionMode: 'file'
    });
  });

  it('Thread 不存在时抛出清晰错误', async () => {
    threadGet.mockResolvedValue(null);

    await expect(
      new ThreadExecutionFactory().createRequest({
        threadId: 'missing-thread',
        message: 'hello'
      })
    ).rejects.toThrow('Thread missing-thread not found');
  });

  it('Agent 不存在时抛出清晰错误', async () => {
    threadGet.mockResolvedValue({
      id: 'thread-1',
      agentId: 'missing-agent',
      agentMode: 'agent'
    });
    agentGet.mockResolvedValue(null);

    await expect(
      new ThreadExecutionFactory().createRequest({
        threadId: 'thread-1',
        message: 'hello'
      })
    ).rejects.toThrow('Agent missing-agent not found');
  });
});
