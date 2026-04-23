/**
 * ThreadStore 增强字段测试
 *
 * 验证新增字段：sessionId, agentMode, agentType, runStatus
 * 以及 ThreadIndexEntry 的新字段同步。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('@main/common/logger', () => {
  const mockLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { log: mockLog, default: mockLog, createLogger: vi.fn(() => mockLog) };
});

vi.mock('@main/utils/SnowflakeIdGenerator', () => {
  let counter = 100000000000000000n;
  return {
    generateSnowflakeId: () => {
      counter += 1n;
      return counter.toString();
    }
  };
});

let tmpDir: string;
let workspacesDir: string;

vi.mock('@main/common/env', () => ({
  get Env() {
    return {
      paths: {
        threadsDir: tmpDir,
        workspacesDir,
        homesDir: path.join(tmpDir, '..', 'agents'),
        userHome: tmpDir,
        userAgentsDir: path.join(tmpDir, '..', 'agent-defs'),
        builtinAgentsDir: path.join(tmpDir, '..', 'builtin-agents')
      },
      getAgentHomeDir: async (agentId: string) => path.join(tmpDir, '..', 'agents', agentId),
      getAgentWorkspaceDir: async (_agentId: string, threadId: string) => path.join(workspacesDir, threadId)
    };
  }
}));

vi.mock('../../agents/AgentStore', () => ({
  AgentStore: {
    getInstance: vi.fn(() => ({
      get: vi.fn(async (id: string) => ({ id, name: id }))
    }))
  }
}));

vi.mock('@main/config/threads', () => ({
  Threads: {
    getWorkspaceDir: vi.fn(async (threadId: string) => {
      const workspaceDir = path.join(workspacesDir, threadId);
      fs.mkdirSync(workspaceDir, { recursive: true });
      return workspaceDir;
    })
  }
}));

describe('ThreadStore 增强字段', () => {
  let ThreadStore: typeof import('../ThreadStore').ThreadStore;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'threadstore-test-'));
    workspacesDir = path.join(tmpDir, '..', 'workspaces');
    vi.resetModules();
    const mod = await import('../ThreadStore');
    ThreadStore = mod.ThreadStore;
    ThreadStore.resetInstance();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('create 默认填充 sessionId = id, agentMode = agent, runStatus = idle', async () => {
    const store = new ThreadStore(tmpDir, workspacesDir);
    const thread = await store.create({ title: 'Test', agentId: 'default' });

    expect(thread.sessionId).toBe(thread.id);
    expect(thread.agentMode).toBe('agent');
    expect(thread.runStatus).toBe('idle');
  });

  it('create 支持自定义 agentMode', async () => {
    const store = new ThreadStore(tmpDir, workspacesDir);
    const thread = await store.create({
      title: 'Chat Task',
      agentId: 'chat-1',
      agentMode: 'chat'
    });

    expect(thread.agentMode).toBe('chat');
  });

  it('update 可以修改 runStatus', async () => {
    const store = new ThreadStore(tmpDir, workspacesDir);
    const thread = await store.create({ title: 'Task', agentId: 'a1' });

    const updated = await store.update(thread.id, { runStatus: 'running' });
    expect(updated!.runStatus).toBe('running');

    const updated2 = await store.update(thread.id, { runStatus: 'idle' });
    expect(updated2!.runStatus).toBe('idle');
  });

  it('list 返回的索引条目包含 runStatus 和 workspacePath', async () => {
    const store = new ThreadStore(tmpDir, workspacesDir);
    await store.create({ title: 'A', agentId: 'a1', agentMode: 'chat' });
    await store.create({ title: 'B', agentId: 'a2' });

    const list = await store.listAsync();
    expect(list).toHaveLength(2);
    expect(list[0].runStatus).toBe('idle');
    expect(list[0].workspacePath).toBe(path.join(workspacesDir, list[0].id));
    expect(list[1].runStatus).toBe('idle');
    expect(list[1].workspacePath).toBe(path.join(workspacesDir, list[1].id));
  });

  it('list 兼容入口委托到异步批量读取', async () => {
    const store = new ThreadStore(tmpDir, workspacesDir);
    await store.create({ title: 'A', agentId: 'a1' });
    await store.create({ title: 'B', agentId: 'a2' });

    const list = await store.list({ agentId: 'a1' });
    expect(list).toHaveLength(1);
    expect(list[0].agentId).toBe('a1');
  });

  it('get 返回包含所有新字段的完整定义', async () => {
    const store = new ThreadStore(tmpDir, workspacesDir);
    const created = await store.create({
      title: 'Full',
      agentId: 'a1',
      agentMode: 'chat'
    });

    const loaded = await store.get(created.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.sessionId).toBe(created.id);
    expect(loaded!.agentMode).toBe('chat');
    expect(loaded!.runStatus).toBe('idle');
  });

  it('向后兼容：加载缺少新字段的旧 JSON 文件', async () => {
    const store = new ThreadStore(tmpDir, workspacesDir);

    // 手动写入旧格式的 JSON
    const oldThread = {
      id: '999999999999999999',
      title: 'Old Thread',
      agentId: 'default',
      status: 'active',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z'
    };
    fs.writeFileSync(path.join(tmpDir, '999999999999999999.json'), JSON.stringify(oldThread, null, 2), 'utf-8');

    await store.init();
    const list = await store.list();
    expect(list).toHaveLength(1);
    // 旧文件缺少 runStatus，toIndexEntry 使用默认值
    expect(list[0].runStatus).toBe('idle');
  });

  it('持久化到磁盘后重新加载保持新字段', async () => {
    const store1 = new ThreadStore(tmpDir, workspacesDir);
    const created = await store1.create({
      title: 'Persist Test',
      agentId: 'a1',
      agentMode: 'chat'
    });
    await store1.update(created.id, { runStatus: 'running' });

    // 用新 store 实例重新加载
    const store2 = new ThreadStore(tmpDir, workspacesDir);
    const loaded = await store2.get(created.id);
    expect(loaded!.runStatus).toBe('running');
    expect(loaded!.agentMode).toBe('chat');
    expect(loaded!.sessionId).toBe(created.id);
  });
});
