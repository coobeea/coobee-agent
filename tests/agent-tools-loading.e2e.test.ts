/**
 * Agent 工具和技能加载 E2E 测试
 *
 * 验证：
 * 1. 工具是否正确注册到 ToolRegistry
 * 2. Agent 运行时是否能获取到工具
 * 3. Agent 是否能正确调用工具
 * 4. 技能是否正确加载
 * 5. 多轮对话场景
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { TestWsClient } from './helpers/ws-client';

const WS_URL = 'ws://127.0.0.1:8765/gateway/ws';
const GATEWAY_HEALTH_URL = 'http://127.0.0.1:8765/gateway/health';

describe('Agent 工具和技能加载 E2E 测试', () => {
  let client: TestWsClient;
  let threadId: string;

  beforeAll(async () => {
    // 1. 等待 Gateway 就绪
    console.log('[Setup] Waiting for Gateway...');
    let retries = 20;
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
      throw new Error('Gateway not ready after 20 seconds');
    }

    // 2. 连接 WebSocket
    console.log('[Setup] Connecting to Gateway WebSocket...');
    client = new TestWsClient({ url: WS_URL, debug: true });
    await client.connect();
    console.log('[Setup] Connected to Gateway WebSocket');
  });

  afterAll(async () => {
    if (client) {
      client.close();
    }
  });

  describe('1. 工具注册验证', () => {
    it('应该能列出所有已注册的方法', async () => {
      const result = await client.request('system.methods', {});
      expect(result).toHaveProperty('methods');
      expect(Array.isArray(result.methods)).toBe(true);

      const methods = result.methods as string[];
      console.log('[Test] Available methods:', methods);

      // 验证核心方法存在
      expect(methods).toContain('chat.createThread');
      expect(methods).toContain('chat.sendMessage');
      expect(methods).toContain('system.methods');
    });
  });

  describe('2. Thread 创建和工具加载', () => {
    it('应该能创建 Thread', async () => {
      const result = await client.request('chat.createThread', {
        title: 'E2E 工具加载测试'
      });

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('title');
      expect(result.title).toBe('E2E 工具加载测试');

      threadId = result.id;
      console.log('[Test] Created thread:', threadId);
    });
  });

  describe('3. 工具调用测试（skill_list）', () => {
    it('应该能通过 Agent 调用 skill_list 工具', async () => {
      const message = '请使用 skill_list 工具列出所有可用的技能，然后告诉我有多少个技能';

      // 发送消息
      const sendResult = await client.request('chat.sendMessage', {
        threadId,
        message
      });

      console.log('[Test] Message sent:', sendResult);
      expect(sendResult).toHaveProperty('success');
      expect(sendResult.success).toBe(true);

      // 等待处理完成（监听 stream.completed 事件）
      console.log('[Test] Waiting for stream to complete...');
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          console.log('[Test] Timeout after 30s, continuing anyway...');
          resolve();
        }, 30000);

        client.on('event', (event, payload) => {
          if (event === 'stream.completed' && payload?.sessionId === threadId) {
            console.log('[Test] Stream completed');
            clearTimeout(timeout);
            resolve();
          }
        });
      });

      // 检查 events.jsonl 文件
      const workspaceDir = path.join(process.cwd(), '.home', 'workspaces', threadId);
      const eventsFile = path.join(workspaceDir, '.runtime', 'events', 'events.jsonl');

      console.log('[Test] Checking events file:', eventsFile);
      expect(fs.existsSync(eventsFile)).toBe(true);

      const content = fs.readFileSync(eventsFile, 'utf-8');
      const lines = content.trim().split('\n');

      // 解析所有事件
      const events = lines
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      console.log(`[Test] Total events: ${events.length}`);

      // 查找工具调用事件
      const toolStartEvents = events.filter((e) => e.type === 'tool:start');
      const toolDoneEvents = events.filter((e) => e.type === 'tool:done');

      console.log(`[Test] Tool start events: ${toolStartEvents.length}`);
      console.log(`[Test] Tool done events: ${toolDoneEvents.length}`);

      // 验证：至少应该有一次 skill_list 工具调用
      expect(toolStartEvents.length).toBeGreaterThan(0);
      expect(toolDoneEvents.length).toBeGreaterThan(0);

      const skillListCalls = toolStartEvents.filter((e) => e.data?.toolName === 'skill_list');
      expect(skillListCalls.length).toBeGreaterThan(0);

      console.log('[Test] ✅ skill_list tool was called:', skillListCalls.length, 'times');

      // 打印工具调用详情
      toolStartEvents.forEach((event, i) => {
        console.log(`[Test] Tool call ${i + 1}: ${event.data?.toolName}`);
      });
    }, 45000); // 45秒超时
  });

  describe('4. 工具调用测试（read + glob）', () => {
    it('应该能通过 Agent 调用 read 和 glob 工具', async () => {
      const message =
        '请先使用 glob 工具找出 src/main/lifecycle 目录下所有的 .ts 文件，然后使用 read 工具读取 src/main/lifecycle/ReadyAgentSystemHook.ts 文件的前20行内容并告诉我文件的主要功能';

      // 发送消息
      const sendResult = await client.request('chat.sendMessage', {
        threadId,
        message
      });

      console.log('[Test] Message sent:', sendResult);

      // 等待处理完成
      console.log('[Test] Waiting for stream to complete...');
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          console.log('[Test] Timeout after 30s, continuing anyway...');
          resolve();
        }, 30000);

        client.on('event', (event, payload) => {
          if (event === 'stream.completed' && payload?.sessionId === threadId) {
            console.log('[Test] Stream completed');
            clearTimeout(timeout);
            resolve();
          }
        });
      });

      // 检查 events.jsonl 文件
      const workspaceDir = path.join(process.cwd(), '.home', 'workspaces', threadId);
      const eventsFile = path.join(workspaceDir, '.runtime', 'events', 'events.jsonl');

      const content = fs.readFileSync(eventsFile, 'utf-8');
      const lines = content.trim().split('\n');

      // 解析所有事件
      const events = lines
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      // 查找工具调用事件
      const toolStartEvents = events.filter((e) => e.type === 'tool:start');

      console.log(`[Test] Total tool calls in this turn: ${toolStartEvents.length}`);

      // 打印所有工具调用
      const allToolCalls = toolStartEvents.map((e) => e.data?.toolName);
      console.log('[Test] All tool calls:', allToolCalls);

      // 验证：应该有 glob 和 read 工具调用
      expect(allToolCalls).toContain('glob');
      expect(allToolCalls).toContain('read');

      console.log('[Test] ✅ glob and read tools were called successfully');
    }, 45000);
  });

  describe('5. 工具加载统计', () => {
    it('应该能从日志中验证工具注册数量', async () => {
      const workspaceDir = path.join(process.cwd(), '.home', 'workspaces', threadId);
      const eventsFile = path.join(workspaceDir, '.runtime', 'events', 'events.jsonl');

      const content = fs.readFileSync(eventsFile, 'utf-8');
      const lines = content.trim().split('\n');

      const events = lines
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      // 统计工具调用
      const toolCalls = events.filter((e) => e.type === 'tool:start');
      const uniqueTools = new Set(toolCalls.map((e) => e.data?.toolName));

      console.log('[Test] 统计结果:');
      console.log(`  - 总工具调用次数: ${toolCalls.length}`);
      console.log(`  - 使用的不同工具: ${uniqueTools.size}`);
      console.log(`  - 工具列表: ${Array.from(uniqueTools).join(', ')}`);

      expect(toolCalls.length).toBeGreaterThan(0);
      expect(uniqueTools.size).toBeGreaterThan(0);
    });
  });
});
