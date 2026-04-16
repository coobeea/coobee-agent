import { describe, it, expect, beforeAll, vi } from 'vitest';
import path from 'path';

vi.mock('@main/common/env', () => {
  return {
    Env: {
      paths: {
        userAgentsDir: path.join(process.cwd(), '.test-home/agents'),
        builtinAgentsDir: path.join(process.cwd(), 'resources/agents'),
        userHome: path.join(process.cwd(), '.test-home'),
        secretsDir: path.join(process.cwd(), '.test-home/secrets'),
      },
      getAgentWorkspaceDir: async () => path.join(process.cwd(), '.test-home/workspace'),
      getAgentHomeDir: async (id: string) => path.join(process.cwd(), '.test-home/homes', id),
      getSkillSearchPaths: async () => [path.join(process.cwd(), 'resources/skills')],
    }
  };
});

vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    info: console.log,
    warn: console.warn,
    error: console.error,
    debug: console.log,
  }),
  log: {
    info: console.log,
    warn: console.warn,
    error: console.error,
    debug: console.log,
  }
}));

vi.mock('electron', () => ({
  app: { 
    getAppPath: () => process.cwd(),
    getPath: (name: string) => {
      if (name === 'exe') return process.execPath;
      return `${process.cwd()}/.test-home/${name}`;
    },
    getName: () => 'coobee-agent',
    getVersion: () => '1.0.0',
    getLocale: () => 'zh-CN',
    isPackaged: false
  },
  BrowserWindow: {
    getAllWindows: () => []
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn()
  }
}));

import { agentExecutor } from '../AgentExecutor';
import { AgentStore } from '../agents/AgentStore';
import { generateSnowflakeId } from '../../utils/SnowflakeIdGenerator';

describe('AgentExecutor Integration', () => {
  beforeAll(async () => {
    const store = AgentStore.getInstance();
    await store.init();
    
    // Set up dummy Ollama environment
    process.env.VITE_LLM_API_KEY = 'ollama';
    process.env.VITE_LLM_BASE_URL = 'http://127.0.0.1:11434/v1';
  });

  it('should run app-copilot with ollama/qwen3.5:9b', async () => {
    const agentId = 'app-copilot';
    const store = AgentStore.getInstance();
    const agentDef = await store.get(agentId);
    
    expect(agentDef).toBeDefined();
    
    const sessionId = `test-session-${generateSnowflakeId()}`;
    const message = "你好，请介绍一下你自己。";
    
    const model = 'qwen3.5:9b';
    
    const builder = agentExecutor
      .piMono()
      .lightweight(true)
      .mode('chat')
      .name(agentId)
      .sessionMode('memory')
      .maxTurns(1)
      .model(model);
      
    if (agentDef!.instructions) {
      builder.instructions(agentDef!.instructions);
    }
    
    const gen = agentExecutor.stream({ sessionId, message, builder });
    
    let output = '';
    for await (const chunk of gen) {
      if (chunk.type === 'text:delta' && chunk.content) {
        output += chunk.content;
      }
    }
    
    console.log('Assistant Output:', output);
    expect(output.length).toBeGreaterThan(0);
  }, 60000); // 60s timeout
});
