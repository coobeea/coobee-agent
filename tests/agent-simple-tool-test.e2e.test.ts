/**
 * 简化的工具加载测试
 *
 * 快速验证：
 * 1. 工具是否正确注册
 * 2. Agent 是否能调用工具
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestWsClient } from './helpers/ws-client';
import path from 'path';
import fs from 'fs';

const WS_URL = 'ws://127.0.0.1:8765/gateway/ws';
const GATEWAY_HEALTH_URL = 'http://127.0.0.1:8765/gateway/health';

describe('工具加载快速验证', () => {
  let client: TestWsClient;
  let threadId: string;

  beforeAll(async () => {
    // 等待 Gateway 就绪
    console.log('[Setup] Waiting for Gateway...');
    let retries = 10;
    while (retries > 0) {
      try {
        const response = await fetch(GATEWAY_HEALTH_URL);
        if (response.ok) {
          console.log('[Setup] Gateway is ready');
          break;
        }
      } catch {
        // ignore
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      retries--;
    }

    if (retries === 0) {
      throw new Error('Gateway not ready after 10 seconds');
    }

    // 连接 WebSocket
    client = new TestWsClient({ url: WS_URL, debug: false });
    await client.connect();
    console.log('[Setup] Connected');
  });

  afterAll(async () => {
    if (client) {
      client.close();
    }
  });

  it('应该能创建 Thread 并使用 glob 工具', async () => {
    // 1. 创建 Thread
    const createResult = await client.request('chat.createThread', {
      title: '工具测试'
    });
    threadId = (createResult as any).id;
    console.log('✅ Thread created:', threadId);

    // 2. 发送使用 glob 工具的消息
    const message = '请使用 glob 工具找出 src/main/lifecycle 目录下所有的文件，列出文件名即可';

    await client.request('chat.sendMessage', {
      threadId,
      message
    });
    console.log('✅ Message sent');

    // 3. 等待执行完成 - 监听 stream.completed 事件
    const completed = await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        console.log('⏱️  Timeout after 45s');
        resolve(false);
      }, 45000);

      client.on('event', (event, payload) => {
        if (event === 'stream:completed' && payload?.sessionId === threadId) {
          console.log('✅ Stream completed');
          clearTimeout(timeout);
          resolve(true);
        }
      });
    });

    // 4. 检查 events.jsonl 文件
    const workspaceDir = path.join(process.cwd(), '.home', 'workspaces', threadId);
    const eventsFile = path.join(workspaceDir, '.runtime', 'events', 'events.jsonl');

    console.log('[Check] Events file:', eventsFile);

    if (!fs.existsSync(eventsFile)) {
      console.log('❌ Events file not found');
      expect(completed).toBe(true); // 至少流应该完成
      return;
    }

    const content = fs.readFileSync(eventsFile, 'utf-8');
    const events = content
      .trim()
      .split('\n')
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    console.log(`[Stats] Total events: ${events.length}`);

    // 统计工具调用
    const toolCalls = events.filter((e) => e.type === 'tool:start');
    const toolNames = toolCalls.map((e) => e.data?.toolName);

    console.log(`[Stats] Tool calls: ${toolCalls.length}`);
    console.log(`[Stats] Tools used: ${[...new Set(toolNames)].join(', ')}`);

    // 验证：至少调用了 glob 工具
    expect(toolNames).toContain('glob');
    expect(toolCalls.length).toBeGreaterThan(0);

    console.log('✅ 工具加载验证成功！');

    console.log('✅ Test passed: glob tool was called successfully');
  }, 60000); // 60秒超时
});
