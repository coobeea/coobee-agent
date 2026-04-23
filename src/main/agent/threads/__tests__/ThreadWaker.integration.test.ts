/**
 * ThreadWaker 集成测试
 *
 * 验证 Thread 恢复路径通过 ThreadExecutionFactory 复用正常执行路径的 Builder 配置。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const builder = { id: 'mock-builder' };
  const threadStore = {
    get: vi.fn(),
    list: vi.fn(),
    update: vi.fn()
  };
  const agentExecutor = {
    submit: vi.fn()
  };
  const factory = {
    createBuilder: vi.fn()
  };
  const ThreadExecutionFactory = {
    getInstance: vi.fn(() => factory)
  };

  return {
    builder,
    threadStore,
    agentExecutor,
    factory,
    ThreadExecutionFactory
  };
});

vi.mock('@main/common/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  },
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}));

vi.mock('../ThreadStore', () => ({
  ThreadStore: {
    getInstance: vi.fn(async () => mocks.threadStore)
  }
}));

vi.mock('../../AgentExecutor', () => ({
  agentExecutor: mocks.agentExecutor
}));

vi.mock('../../execution/ThreadExecutionFactory', () => ({
  ThreadExecutionFactory: mocks.ThreadExecutionFactory
}));

import { ThreadWaker } from '../ThreadWaker';

type PrivateThreadWaker = {
  submitResumeMessage(threadId: string, message: string): Promise<void>;
  handleRestartRecovery(threadId: string): Promise<void>;
};

describe('ThreadWaker 集成测试', () => {
  beforeEach(() => {
    ThreadWaker.resetInstance();
    vi.clearAllMocks();
    mocks.threadStore.get.mockResolvedValue({
      id: 'thread-1',
      agentId: 'agent-1',
      status: 'active',
      runStatus: 'running'
    });
    mocks.threadStore.list.mockResolvedValue([]);
    mocks.threadStore.update.mockResolvedValue(undefined);
    mocks.factory.createBuilder.mockResolvedValue(mocks.builder);
    mocks.agentExecutor.submit.mockReturnValue({ status: 'accepted', sessionId: 'thread-1' });
  });

  it('恢复提交应该通过 ThreadExecutionFactory 创建 file session Builder', async () => {
    const waker = ThreadWaker.getInstance() as unknown as PrivateThreadWaker;

    await waker.submitResumeMessage('thread-1', 'resume message');

    expect(mocks.ThreadExecutionFactory.getInstance).toHaveBeenCalledWith(mocks.agentExecutor);
    expect(mocks.factory.createBuilder).toHaveBeenCalledWith({
      threadId: 'thread-1',
      sessionMode: 'file',
      isResume: true
    });
    expect(mocks.agentExecutor.submit).toHaveBeenCalledWith({
      sessionId: 'thread-1',
      message: 'resume message',
      builder: mocks.builder
    });
  });

  it('恢复 Builder 创建失败时不应该提交执行', async () => {
    mocks.factory.createBuilder.mockRejectedValueOnce(new Error('Agent not found'));
    const waker = ThreadWaker.getInstance() as unknown as PrivateThreadWaker;

    await waker.submitResumeMessage('thread-1', 'resume message');

    expect(mocks.agentExecutor.submit).not.toHaveBeenCalled();
  });

  it('重启恢复只处理 running / tool-pending 状态', async () => {
    const waker = ThreadWaker.getInstance() as unknown as PrivateThreadWaker;

    await waker.handleRestartRecovery('thread-1');

    expect(mocks.factory.createBuilder).toHaveBeenCalledWith({
      threadId: 'thread-1',
      sessionMode: 'file',
      isResume: true
    });
    expect(mocks.agentExecutor.submit).toHaveBeenCalledOnce();
  });

  it('idle 状态不应该触发恢复提交', async () => {
    mocks.threadStore.get.mockResolvedValueOnce({
      id: 'thread-1',
      agentId: 'agent-1',
      status: 'active',
      runStatus: 'idle'
    });
    const waker = ThreadWaker.getInstance() as unknown as PrivateThreadWaker;

    await waker.handleRestartRecovery('thread-1');

    expect(mocks.factory.createBuilder).not.toHaveBeenCalled();
    expect(mocks.agentExecutor.submit).not.toHaveBeenCalled();
  });

  it('submit 返回 busy 时不应该抛错', async () => {
    mocks.agentExecutor.submit.mockReturnValueOnce({ status: 'busy', sessionId: 'thread-1' });
    const waker = ThreadWaker.getInstance() as unknown as PrivateThreadWaker;

    await expect(waker.submitResumeMessage('thread-1', 'resume message')).resolves.toBeUndefined();
    expect(mocks.agentExecutor.submit).toHaveBeenCalledOnce();
  });
});
