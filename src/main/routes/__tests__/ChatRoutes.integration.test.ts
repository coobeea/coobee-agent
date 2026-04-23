import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import http from 'http';

// Mock dependencies
vi.mock('@main/common/env', () => {
  return {
    Env: {
      paths: {
        userAgentsDir: path.join(process.cwd(), '.test-home/agents'),
        builtinAgentsDir: path.join(process.cwd(), 'resources/agents'),
        userHome: path.join(process.cwd(), '.test-home'),
        userData: path.join(process.cwd(), '.test-home/userData'),
        secretsDir: path.join(process.cwd(), '.test-home/secrets'),
        homesDir: path.join(process.cwd(), '.test-home/agents'),
        threadsDir: path.join(process.cwd(), '.test-home/threads'),
        workspacesDir: path.join(process.cwd(), '.test-home/workspaces')
      },
      getAgentWorkspaceDir: async () => path.join(process.cwd(), '.test-home/workspace'),
      getAgentHomeDir: async (id: string) => path.join(process.cwd(), '.test-home/agents', id),
      getSkillSearchPaths: async () => [path.join(process.cwd(), 'resources/skills')]
    }
  };
});

vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
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

vi.mock('@main/agent/execution/ThreadExecutionFactory', () => ({
  ThreadExecutionFactory: {
    getInstance: vi.fn(() => ({
      createBuilder: vi.fn(async () => ({ mock: 'builder' }))
    }))
  }
}));

vi.mock('@main/agent/AgentExecutor', () => ({
  agentExecutor: {
    stream: vi.fn(() =>
      (async function* () {
        yield { type: 'text:delta', content: '测试成功' };
        yield { type: 'run:done', content: '' };
        return { output: '测试成功' };
      })()
    )
  }
}));

import { registerChatRoutes } from '../ChatRoutes';
import { AgentStore } from '@main/agent/agents/AgentStore';
import { ThreadStore } from '@main/agent/threads/ThreadStore';

describe('ChatRoutes Integration', () => {
  let app: Koa;
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    // Initialize stores
    const agentStore = AgentStore.getInstance();
    await agentStore.init();

    const threadStore = await ThreadStore.getInstance();
    await threadStore.init();

    // Set up dummy Ollama environment
    process.env.VITE_LLM_API_KEY = 'ollama';
    process.env.VITE_LLM_BASE_URL = 'http://127.0.0.1:11434/v1';

    // Set up Koa app
    app = new Koa();
    app.use(bodyParser());
    const router = new Router({ prefix: '/gateway' });
    registerChatRoutes(router);
    app.use(router.routes());
    app.use(router.allowedMethods());

    server = http.createServer(app.callback());
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        port = (server.address() as any).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('should create a thread, list it, and send a message with SSE', async () => {
    // 1. Create a thread
    const createRes = await fetch(`http://127.0.0.1:${port}/gateway/chat/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Test Thread',
        agentId: 'app-copilot',
        overrideModel: 'qwen3.5:9b'
      })
    });

    expect(createRes.status).toBe(200);
    const createData = await createRes.json();
    expect(createData.success).toBe(true);
    const threadId = createData.data.id;
    expect(threadId).toBeDefined();

    // 2. List threads
    const listRes = await fetch(`http://127.0.0.1:${port}/gateway/chat/threads`);
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    expect(listData.success).toBe(true);
    expect(listData.data.threads.length).toBeGreaterThan(0);

    // 3. Send a message (SSE)
    return new Promise<void>((resolve, reject) => {
      let output = '';

      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: `/gateway/chat/threads/${threadId}/messages`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        },
        (res) => {
          expect(res.statusCode).toBe(200);
          expect(res.headers['content-type']).toBe('text/event-stream');

          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            const lines = chunk.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                try {
                  const data = JSON.parse(line.substring(6));
                  if (data.type === 'text:delta' && data.content) {
                    output += data.content;
                  }
                } catch (e) {
                  // ignore
                }
              }
            }
          });

          res.on('end', () => {
            expect(output.length).toBeGreaterThan(0);
            resolve();
          });

          res.on('error', reject);
        }
      );

      req.on('error', reject);
      req.write(JSON.stringify({ message: '你好，请说“测试成功”' }));
      req.end();
    });
  }, 60000);
});
