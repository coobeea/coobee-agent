import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDefinition } from '../types';

vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

let tmpDir: string;
let userDir: string;
let agentHomesDir: string;
let builtinAgentsDir: string;

vi.mock('@main/common/env', () => ({
  get Env() {
    return {
      paths: {
        userHome: tmpDir,
        userAgentsDir: userDir,
        builtinAgentsDir
      }
    };
  }
}));

function writeAgent(dir: string, agent: AgentDefinition): void {
  fs.writeFileSync(path.join(dir, `${agent.id}.json`), JSON.stringify(agent, null, 2), 'utf-8');
}

function createAgent(id: string, createdBy: AgentDefinition['createdBy'] = 'user'): AgentDefinition {
  const now = new Date().toISOString();
  return {
    id,
    name: id,
    description: `${id} description`,
    instructions: `${id} instructions`,
    createdAt: now,
    updatedAt: now,
    createdBy,
    version: 1,
    skills: []
  };
}

describe('AgentStore 异步列表', () => {
  let AgentStore: typeof import('../AgentStore').AgentStore;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentstore-async-list-'));
    userDir = path.join(tmpDir, 'agents');
    agentHomesDir = path.join(tmpDir, 'agents');
    builtinAgentsDir = path.join(tmpDir, 'builtin-agents');
    fs.mkdirSync(userDir, { recursive: true });
    fs.mkdirSync(agentHomesDir, { recursive: true });
    fs.mkdirSync(builtinAgentsDir, { recursive: true });

    vi.resetModules();
    const mod = await import('../AgentStore');
    AgentStore = mod.AgentStore;
    AgentStore.resetInstance();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('listAsync 会通过异步索引重建读取用户和内置 Agent', async () => {
    writeAgent(userDir, createAgent('alpha'));
    writeAgent(userDir, createAgent('beta'));
    writeAgent(builtinAgentsDir, createAgent('builtin-helper', 'system'));

    const store = new AgentStore(userDir, agentHomesDir);
    const agents = await store.listAsync();

    expect(agents.map((agent) => agent.id).sort()).toEqual(['alpha', 'beta', 'builtin-helper']);
    expect(agents.find((agent) => agent.id === 'builtin-helper')?.createdBy).toBe('system');
  });

  it('list 兼容入口仍返回异步索引结果', async () => {
    writeAgent(userDir, createAgent('alpha'));

    const store = new AgentStore(userDir, agentHomesDir);
    const agents = await store.list();

    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe('alpha');
  });

  it('create/update 会保存 Agent 默认运行配置并同步到索引', async () => {
    const store = new AgentStore(userDir, agentHomesDir);

    const created = await store.create({
      id: 'runtime-agent',
      name: 'Runtime Agent',
      description: 'runtime defaults',
      instructions: 'hello',
      runtimeType: 'openai',
      enableThinking: true,
      asrEnabled: true,
      ttsEnabled: false
    });

    expect(created.runtimeType).toBe('openai');
    expect(created.enableThinking).toBe(true);
    expect(created.asrEnabled).toBe(true);
    expect(created.ttsEnabled).toBe(false);

    const list = await store.listAsync();
    expect(list.find((agent) => agent.id === 'runtime-agent')).toMatchObject({
      runtimeType: 'openai',
      enableThinking: true,
      asrEnabled: true,
      ttsEnabled: false
    });

    const updated = await store.update('runtime-agent', {
      runtimeType: 'claude',
      enableThinking: false,
      asrEnabled: false,
      ttsEnabled: true
    });

    expect(updated).toMatchObject({
      runtimeType: 'claude',
      enableThinking: false,
      asrEnabled: false,
      ttsEnabled: true
    });
  });

  it('create/update 会清理旧版模型组配置', async () => {
    const store = new AgentStore(userDir, agentHomesDir);

    const created = await store.create({
      id: 'legacy-model-agent',
      name: 'Legacy Model Agent',
      description: 'legacy model',
      instructions: 'hello',
      model: '@group:default'
    });

    expect(created.model).toBeUndefined();
    expect((await store.listAsync()).find((agent) => agent.id === 'legacy-model-agent')?.model).toBeUndefined();

    const filePath = path.join(userDir, 'legacy-model-agent.json');
    expect(fs.readFileSync(filePath, 'utf-8')).not.toContain('@group:default');

    const withModel = await store.update('legacy-model-agent', { model: 'ollama/gemma4:e4b' });
    expect(withModel?.model).toBe('ollama/gemma4:e4b');

    const cleared = await store.update('legacy-model-agent', { model: '@group:default' });
    expect(cleared?.model).toBeUndefined();
    expect(fs.readFileSync(filePath, 'utf-8')).not.toContain('@group:default');
  });

  it('update 会合并 metadata，避免快捷问题局部保存覆盖其他配置', async () => {
    const store = new AgentStore(userDir, agentHomesDir);

    await store.create({
      id: 'metadata-agent',
      name: 'Metadata Agent',
      description: 'metadata patch',
      instructions: 'hello',
      metadata: {
        greeting: '你好',
        starterPrompts: ['第一个问题'],
        dataDirectory: '/tmp/agent-data'
      }
    });

    const updated = await store.update('metadata-agent', {
      metadata: {
        starterPrompts: ['第一个问题', '第二个问题']
      }
    });

    expect(updated?.metadata).toMatchObject({
      greeting: '你好',
      starterPrompts: ['第一个问题', '第二个问题'],
      dataDirectory: '/tmp/agent-data'
    });

    const cleared = await store.update('metadata-agent', {
      metadata: {
        starterPrompts: []
      }
    });

    expect(cleared?.metadata).toMatchObject({
      greeting: '你好',
      starterPrompts: [],
      dataDirectory: '/tmp/agent-data'
    });
  });
});
