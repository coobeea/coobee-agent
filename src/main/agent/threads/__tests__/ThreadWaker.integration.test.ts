/**
 * ThreadWaker 集成测试
 *
 * 验证启动恢复逻辑直接扫描 ThreadStore，并通过 ThreadExecutor 提交恢复消息。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  };
  const threadStore = {
    listAsync: vi.fn()
  };
  const threadExecutor = {
    submit: vi.fn()
  };

  return {
    logger,
    threadStore,
    threadExecutor
  };
});

vi.mock('@main/common/logger', () => ({
  createLogger: () => mocks.logger
}));

vi.mock('../ThreadStore', () => ({
  ThreadStore: {
    getInstance: vi.fn(async () => mocks.threadStore)
  }
}));

vi.mock('../../ThreadExecutor', () => ({
  ThreadExecutor: { submit: mocks.threadExecutor.submit }
}));

import { recoverPendingThreads } from '../ThreadWaker';

function thread(id: string, runStatus: string, status = 'active'): Record<string, string> {
  return {
    id,
    title: id,
    agentId: 'agent-1',
    status,
    runStatus,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    workspacePath: `/tmp/${id}`,
    agentHomePath: `/tmp/agents/agent-1`
  };
}

describe('ThreadWaker 启动恢复', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.threadStore.listAsync.mockResolvedValue([]);
    mocks.threadExecutor.submit.mockResolvedValue({ status: 'accepted', sessionId: 'thread-1' });
  });

  it('无 pending threads 时不提交恢复消息', async () => {
    mocks.threadStore.listAsync.mockResolvedValue([
      thread('idle-thread', 'idle'),
      thread('completed-thread', 'completed'),
      thread('deleted-running-thread', 'running', 'deleted')
    ]);

    await recoverPendingThreads();

    expect(mocks.threadExecutor.submit).not.toHaveBeenCalled();
    expect(mocks.logger.info).toHaveBeenCalledWith('[ThreadWaker] No pending threads to recover on startup');
  });

  it('只恢复 active 且 running 的 threads', async () => {
    mocks.threadStore.listAsync.mockResolvedValue([
      thread('running-thread', 'running'),
      thread('idle-thread', 'idle'),
      thread('archived-running-thread', 'running', 'archived')
    ]);

    await recoverPendingThreads();

    expect(mocks.threadExecutor.submit).toHaveBeenCalledTimes(1);
    expect(mocks.threadExecutor.submit).toHaveBeenNthCalledWith(
      1,
      'running-thread',
      expect.stringContaining('[System]')
    );
  });

  it('submit 返回 busy 时记录 warn 且不抛出', async () => {
    mocks.threadStore.listAsync.mockResolvedValue([thread('busy-thread', 'running')]);
    mocks.threadExecutor.submit.mockResolvedValueOnce({ status: 'busy', sessionId: 'busy-thread' });

    await expect(recoverPendingThreads()).resolves.toBeUndefined();

    expect(mocks.logger.warn).toHaveBeenCalledWith('[ThreadWaker] Thread busy-thread is busy, skipping recovery');
  });

  it('单个 thread submit 失败不影响其他 thread 恢复', async () => {
    mocks.threadStore.listAsync.mockResolvedValue([thread('bad-thread', 'running'), thread('good-thread', 'running')]);
    mocks.threadExecutor.submit
      .mockRejectedValueOnce(new Error('Agent not found'))
      .mockResolvedValueOnce({ status: 'accepted', sessionId: 'good-thread' });

    await recoverPendingThreads();

    expect(mocks.threadExecutor.submit).toHaveBeenCalledTimes(2);
    expect(mocks.logger.error).toHaveBeenCalledWith(
      '[ThreadWaker] Failed to submit resume message for bad-thread:',
      expect.any(Error)
    );
    expect(mocks.logger.info).toHaveBeenCalledWith('[ThreadWaker] Thread good-thread resumed successfully');
  });

  it('ThreadStore listAsync 失败时记录 error 且不抛出', async () => {
    mocks.threadStore.listAsync.mockRejectedValueOnce(new Error('disk error'));

    await expect(recoverPendingThreads()).resolves.toBeUndefined();

    expect(mocks.logger.error).toHaveBeenCalledWith('[ThreadWaker] Startup recovery scan failed:', expect.any(Error));
  });
});
