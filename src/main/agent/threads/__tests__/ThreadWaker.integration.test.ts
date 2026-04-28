/**
 * ThreadWaker 集成测试
 *
 * 验证 Thread 恢复路径通过 ThreadExecutor 复用正常执行入口。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const threadStore = {
    get: vi.fn(),
    list: vi.fn(),
    update: vi.fn()
  };
  const threadExecutor = {
    submit: vi.fn()
  };

  return {
    threadStore,
    threadExecutor
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

vi.mock('../../ThreadExecutor', () => ({
  threadExecutor: mocks.threadExecutor
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
    mocks.threadExecutor.submit.mockReturnValue({ status: 'accepted', sessionId: 'thread-1' });
  });

  it('恢复提交应该通过 ThreadExecutor 提交 threadId/message', async () => {
    const waker = ThreadWaker.getInstance() as unknown as PrivateThreadWaker;

    await waker.submitResumeMessage('thread-1', 'resume message');

    expect(mocks.threadExecutor.submit).toHaveBeenCalledWith('thread-1', 'resume message');
  });

  it('恢复提交失败时不应该抛出', async () => {
    mocks.threadExecutor.submit.mockRejectedValueOnce(new Error('Agent not found'));
    const waker = ThreadWaker.getInstance() as unknown as PrivateThreadWaker;

    await expect(waker.submitResumeMessage('thread-1', 'resume message')).resolves.toBeUndefined();
  });

  it('重启恢复只处理 running / tool-pending 状态', async () => {
    const waker = ThreadWaker.getInstance() as unknown as PrivateThreadWaker;

    await waker.handleRestartRecovery('thread-1');

    expect(mocks.threadExecutor.submit).toHaveBeenCalledOnce();
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

    expect(mocks.threadExecutor.submit).not.toHaveBeenCalled();
  });

  it('submit 返回 busy 时不应该抛错', async () => {
    mocks.threadExecutor.submit.mockReturnValueOnce({ status: 'busy', sessionId: 'thread-1' });
    const waker = ThreadWaker.getInstance() as unknown as PrivateThreadWaker;

    await expect(waker.submitResumeMessage('thread-1', 'resume message')).resolves.toBeUndefined();
    expect(mocks.threadExecutor.submit).toHaveBeenCalledOnce();
  });
});
