import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThreadExecutionFactory } from '../ThreadExecutionFactory';

const threadGet = vi.fn();
const threadUpdate = vi.fn();
const agentGet = vi.fn();

vi.mock('../../threads/ThreadStore', () => ({
  ThreadStore: {
    getInstance: vi.fn(async () => ({
      get: threadGet,
      update: threadUpdate
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
    threadUpdate.mockReset();
    agentGet.mockReset();
  });

  it('根据 threadId 和 message 生成标准 AgentExecuteRequest', async () => {
    threadGet.mockResolvedValue({
      id: 'thread-1',
      title: '已有标题',
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
    expect(threadUpdate).not.toHaveBeenCalled();
  });

  it('默认标题会在组装请求前按消息内容自动命名', async () => {
    threadGet.mockResolvedValue({
      id: 'thread-1',
      title: '新任务',
      agentId: 'agent-1',
      agentMode: 'agent'
    });
    agentGet.mockResolvedValue({
      id: 'agent-1',
      instructions: 'system prompt',
      model: 'provider/model-b'
    });

    await new ThreadExecutionFactory().createRequest({
      threadId: 'thread-1',
      message: '  帮我分析一下这个项目的事件流转机制，越清晰越好  '
    });

    expect(threadUpdate).toHaveBeenCalledWith('thread-1', {
      title: '帮我分析一下这个项目的事件流转机制，越清晰越好'
    });
  });

  it('自动标题会压缩空白并截断过长消息', async () => {
    threadGet.mockResolvedValue({
      id: 'thread-1',
      title: '新会话',
      agentId: 'agent-1',
      agentMode: 'agent'
    });
    agentGet.mockResolvedValue({
      id: 'agent-1',
      instructions: 'system prompt',
      model: 'provider/model-b'
    });

    await new ThreadExecutionFactory().createRequest({
      threadId: 'thread-1',
      message: '第一行\n第二行  第三行，后面还有很多很多内容用于测试标题截断'
    });

    expect(threadUpdate).toHaveBeenCalledWith('thread-1', {
      title: '第一行 第二行 第三行，后面还有很多很多内容用于测试标题'
    });
  });

  it('用户已命名的 Thread 不自动改标题', async () => {
    threadGet.mockResolvedValue({
      id: 'thread-1',
      title: '重要任务',
      agentId: 'agent-1',
      agentMode: 'agent'
    });
    agentGet.mockResolvedValue({
      id: 'agent-1',
      instructions: 'system prompt',
      model: 'provider/model-b'
    });

    await new ThreadExecutionFactory().createRequest({
      threadId: 'thread-1',
      message: '新的消息'
    });

    expect(threadUpdate).not.toHaveBeenCalled();
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
