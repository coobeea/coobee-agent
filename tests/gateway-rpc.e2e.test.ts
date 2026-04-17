/**
 * Gateway RPC 端到端测试
 *
 * 测试新实现的 WebSocket RPC 方法，包括：
 * 1. System 方法（system.methods, system.health, system.ping, system.echo, system.version）
 * 2. Chat 方法（chat.createThread, chat.listThreads, chat.getThread, chat.sendMessage, chat.abortMessage）
 *
 * 运行方式：
 *   pnpm test:e2e tests/gateway-rpc.e2e.test.ts
 *
 * 前置条件：
 *   - 应用运行中 (http://127.0.0.1:8765)
 *   - Ollama 运行中 (http://127.0.0.1:11434)
 *   - 已配置 providers.json5
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { TestWsClient } from './helpers/ws-client';

const WS_URL = 'ws://127.0.0.1:8765/gateway/ws';

describe('Gateway RPC E2E', () => {
  let client: TestWsClient;

  beforeAll(() => {
    console.log('\n🚀 开始 Gateway RPC 端到端测试');
    console.log('📍 WebSocket 地址:', WS_URL);
  });

  afterEach(() => {
    if (client) {
      client.close();
    }
  });

  afterAll(() => {
    console.log('\n✅ Gateway RPC 端到端测试完成\n');
  });

  // ==================== 1. System 方法测试 ====================

  describe('System Methods', () => {
    it('should call system.methods and get method list', async () => {
      console.log('\n🔧 测试：system.methods - 获取方法列表');

      client = new TestWsClient({ url: WS_URL, debug: true });
      await client.connect();

      const result = await client.request('system.methods');

      expect(result).toHaveProperty('methods');
      expect(Array.isArray((result as any).methods)).toBe(true);

      const methods = (result as any).methods as string[];
      console.log(`✅ 获取到 ${methods.length} 个方法:`, methods.join(', '));

      // 验证关键方法存在
      expect(methods).toContain('system.methods');
      expect(methods).toContain('system.health');
      expect(methods).toContain('system.ping');
      expect(methods).toContain('system.echo');
      expect(methods).toContain('system.version');
      expect(methods).toContain('chat.createThread');
      expect(methods).toContain('chat.listThreads');
      expect(methods).toContain('chat.getThread');
      expect(methods).toContain('chat.sendMessage');
      expect(methods).toContain('chat.abortMessage');
    });

    it('should call system.health and get server status', async () => {
      console.log('\n🏥 测试：system.health - 健康检查');

      client = new TestWsClient({ url: WS_URL, debug: true });
      await client.connect();

      const result = await client.request('system.health');

      expect(result).toHaveProperty('status', 'ok');
      expect(result).toHaveProperty('clients');
      expect(result).toHaveProperty('methods');
      expect(typeof (result as any).clients).toBe('number');
      expect(typeof (result as any).methods).toBe('number');

      console.log('✅ 健康检查:', {
        status: (result as any).status,
        clients: (result as any).clients,
        methods: (result as any).methods
      });
    });

    it('should call system.ping and get pong response', async () => {
      console.log('\n🏓 测试：system.ping - Ping/Pong');

      client = new TestWsClient({ url: WS_URL, debug: true });
      await client.connect();

      const result = await client.request('system.ping');

      expect(result).toHaveProperty('pong', true);
      expect(result).toHaveProperty('timestamp');
      expect(typeof (result as any).timestamp).toBe('number');

      console.log('✅ Pong:', result);
    });

    it('should call system.echo and get message back', async () => {
      console.log('\n📢 测试：system.echo - 回显测试');

      client = new TestWsClient({ url: WS_URL, debug: true });
      await client.connect();

      const testMessage = 'Hello from RPC test';
      const result = await client.request('system.echo', { message: testMessage });

      expect(result).toHaveProperty('echo', testMessage);
      expect(result).toHaveProperty('timestamp');

      console.log('✅ 回显:', result);
    });

    it('should call system.version and get app version', async () => {
      console.log('\n📦 测试：system.version - 版本信息');

      client = new TestWsClient({ url: WS_URL, debug: true });
      await client.connect();

      const result = await client.request('system.version');

      expect(result).toHaveProperty('version');
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('electron');
      expect(typeof (result as any).version).toBe('string');
      expect(typeof (result as any).name).toBe('string');
      expect(typeof (result as any).electron).toBe('string');

      console.log('✅ 版本信息:', result);
    });
  });

  // ==================== 2. Chat 方法测试 ====================

  describe('Chat Methods', () => {
    let threadId: string;

    it('should call chat.createThread and create a new thread', async () => {
      console.log('\n💬 测试：chat.createThread - 创建会话');

      client = new TestWsClient({ url: WS_URL, debug: true });
      await client.connect();

      const result = await client.request('chat.createThread', {
        title: 'RPC 测试会话',
        agentId: 'app-copilot'
      });

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('title', 'RPC 测试会话');
      expect(result).toHaveProperty('agentId', 'app-copilot');
      expect(result).toHaveProperty('status', 'active');

      threadId = (result as any).id;
      console.log('✅ 会话创建成功:', { id: threadId, title: (result as any).title });
    });

    it('should call chat.listThreads and get thread list', async () => {
      console.log('\n📋 测试：chat.listThreads - 列出所有会话');

      client = new TestWsClient({ url: WS_URL, debug: true });
      await client.connect();

      const result = await client.request('chat.listThreads');

      expect(result).toHaveProperty('threads');
      expect(Array.isArray((result as any).threads)).toBe(true);

      const threads = (result as any).threads;
      console.log(`✅ 获取到 ${threads.length} 个会话`);

      if (threads.length > 0) {
        const thread = threads[0];
        expect(thread).toHaveProperty('id');
        expect(thread).toHaveProperty('title');
        expect(thread).toHaveProperty('agentId');
        console.log('   第一个会话:', {
          id: thread.id,
          title: thread.title,
          agentId: thread.agentId
        });
      }
    });

    it('should call chat.getThread and get thread details', async () => {
      console.log('\n🔍 测试：chat.getThread - 获取会话详情');

      if (!threadId) {
        console.log('⚠️  跳过测试：没有可用的 threadId');
        return;
      }

      client = new TestWsClient({ url: WS_URL, debug: true });
      await client.connect();

      const result = await client.request('chat.getThread', { id: threadId });

      expect(result).toHaveProperty('id', threadId);
      expect(result).toHaveProperty('title');
      expect(result).toHaveProperty('agentId');
      expect(result).toHaveProperty('status');

      console.log('✅ 会话详情:', {
        id: (result as any).id,
        title: (result as any).title,
        agentId: (result as any).agentId,
        status: (result as any).status
      });
    });

    it('should call chat.sendMessage and start streaming (async)', async () => {
      console.log('\n💭 测试：chat.sendMessage - 发送消息（异步）');

      if (!threadId) {
        console.log('⚠️  跳过测试：没有可用的 threadId');
        return;
      }

      client = new TestWsClient({ url: WS_URL, debug: true });
      await client.connect();

      // 监听流式事件
      const events: string[] = [];
      client.on('stream:start', () => {
        console.log('   📡 收到 stream:start 事件');
        events.push('start');
      });

      client.on('stream:message', (payload: any) => {
        console.log('   📡 收到 stream:message 事件:', payload);
        events.push('message');
      });

      client.on('stream:end', () => {
        console.log('   📡 收到 stream:end 事件');
        events.push('end');
      });

      const result = await client.request('chat.sendMessage', {
        threadId,
        message: 'Hello, this is a RPC test message'
      });

      expect(result).toHaveProperty('success', true);
      console.log('✅ 消息发送成功（异步执行）');

      // 等待一段时间看是否有事件
      await new Promise((resolve) => setTimeout(resolve, 2000));

      if (events.length > 0) {
        console.log(`   收到 ${events.length} 个流式事件:`, events);
      } else {
        console.log('   ℹ️  未收到流式事件（Agent 可能正在后台执行）');
      }
    });

    it('should call chat.abortMessage and abort execution', async () => {
      console.log('\n🛑 测试：chat.abortMessage - 中止消息执行');

      if (!threadId) {
        console.log('⚠️  跳过测试：没有可用的 threadId');
        return;
      }

      client = new TestWsClient({ url: WS_URL, debug: true });
      await client.connect();

      const result = await client.request('chat.abortMessage', { threadId });

      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('aborted');
      expect(typeof (result as any).aborted).toBe('boolean');

      console.log('✅ 中止请求已发送:', {
        success: (result as any).success,
        aborted: (result as any).aborted
      });
    });
  });

  // ==================== 3. 错误处理测试 ====================

  describe('Error Handling', () => {
    it('should return error for non-existent method', async () => {
      console.log('\n❌ 测试：调用不存在的方法');

      client = new TestWsClient({ url: WS_URL, debug: true });
      await client.connect();

      try {
        await client.request('nonexistent.method');
        expect.fail('应该抛出错误');
      } catch (error: any) {
        expect(error).toHaveProperty('code', 2001); // METHOD_NOT_FOUND
        expect(error).toHaveProperty('message');
        console.log('✅ 正确返回错误:', error);
      }
    });

    it('should return error for invalid parameters', async () => {
      console.log('\n❌ 测试：无效参数');

      client = new TestWsClient({ url: WS_URL, debug: true });
      await client.connect();

      try {
        await client.request('chat.getThread', {}); // 缺少 id 参数
        expect.fail('应该抛出错误');
      } catch (error: any) {
        expect(error).toHaveProperty('code', 2002); // INVALID_PARAMS
        expect(error).toHaveProperty('message');
        console.log('✅ 正确返回错误:', error);
      }
    });

    it('should return error for non-existent thread', async () => {
      console.log('\n❌ 测试：获取不存在的会话');

      client = new TestWsClient({ url: WS_URL, debug: true });
      await client.connect();

      try {
        await client.request('chat.getThread', { id: 'non-existent-id' });
        expect.fail('应该抛出错误');
      } catch (error: any) {
        expect(error).toHaveProperty('code', 3002); // NOT_FOUND
        expect(error).toHaveProperty('message');
        console.log('✅ 正确返回错误:', error);
      }
    });
  });

  // ==================== 4. 并发测试 ====================

  describe('Concurrent Requests', () => {
    it('should handle multiple concurrent RPC requests', async () => {
      console.log('\n⚡ 测试：并发 RPC 请求');

      client = new TestWsClient({ url: WS_URL, debug: true });
      await client.connect();

      const startTime = Date.now();

      // 发送多个并发请求
      const promises = [
        client.request('system.ping'),
        client.request('system.health'),
        client.request('system.version'),
        client.request('chat.listThreads'),
        client.request('system.echo', { message: 'test1' }),
        client.request('system.echo', { message: 'test2' })
      ];

      const results = await Promise.all(promises);

      const duration = Date.now() - startTime;

      expect(results).toHaveLength(6);
      results.forEach((result, index) => {
        expect(result).toBeDefined();
        console.log(`   结果 ${index + 1}:`, Object.keys(result as object));
      });

      console.log(`✅ 6 个并发请求完成，耗时: ${duration}ms`);
    });
  });
});
