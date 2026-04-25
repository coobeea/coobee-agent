/**
 * Chat HTTP 路由
 *
 * 为对话（Thread）和消息生成提供 REST / SSE 端点。
 * 挂载到 GatewayServer 的 Koa Router（prefix = /gateway），最终路径：
 *
 *   POST   /gateway/chat/threads           — 创建新会话（可指定模型、Agent）
 *   GET    /gateway/chat/threads           — 列出所有会话
 *   GET    /gateway/chat/threads/:id       — 获取会话详情
 *   POST   /gateway/chat/threads/:id/messages — 发送消息并流式返回（SSE）
 *
 * 数据流：
 *   1. 文件持久化: workspaces/{threadId}/sessions/*.jsonl（消息、上下文、事件）
 *   2. WebSocket 广播: 通过 EventBus → WebSocket 推送到 Electron 前端（实时监听）
 *   3. SSE 流式返回: 通过 HTTP Response 返回给 API 客户端（本路由）
 *
 * 设计原则：
 *   - 统一流程: 所有会话都走完整流程（不使用 lightweight 模式）
 *   - 双路并行: SSE 和 WebSocket 同时推送，互不干扰
 *   - 完整持久化: 支持规划（Planning）、任务（Task）、上下文管理
 */

import type Router from '@koa/router';
import { PassThrough } from 'node:stream';
import { createLogger } from '@main/common/logger';
import { ThreadStore } from '@main/agent/threads/ThreadStore';
import { AgentStore } from '@main/agent/agents/AgentStore';
import { agentExecutor } from '@main/agent/AgentExecutor';
import { ThreadExecutionFactory } from '@main/agent/execution/ThreadExecutionFactory';
import type { ApiResponse } from '@shared/api';
import type { ThreadIndexEntry, ThreadDefinition } from '@main/agent/threads/types';

const log = createLogger('chat-routes');

export function registerChatRoutes(router: Router): void {
  // ==================== CREATE THREAD ====================
  router.post('/chat/threads', async (ctx) => {
    try {
      const body = ctx.request.body as {
        title?: string;
        agentId?: string;
        overrideModel?: string;
      };

      // 如果未指定 agentId，默认使用内置的 app-copilot
      const agentId = body.agentId || 'app-copilot';

      const store = await ThreadStore.getInstance();
      const thread = await store.create({
        title: body.title || '新会话',
        agentId,
        overrideModel: body.overrideModel
      });

      const response: ApiResponse<ThreadDefinition> = {
        success: true,
        data: thread
      };
      ctx.body = response;
    } catch (err) {
      log.error('Failed to create thread:', err);
      ctx.status = 500;
      ctx.body = { success: false, error: { message: String(err) } };
    }
  });

  // ==================== LIST THREADS ====================
  router.get('/chat/threads', async (ctx) => {
    try {
      const store = await ThreadStore.getInstance();
      const threads = await store.listAsync();

      const response: ApiResponse<{ threads: ThreadIndexEntry[] }> = {
        success: true,
        data: { threads }
      };
      ctx.body = response;
    } catch (err) {
      log.error('Failed to list threads:', err);
      ctx.status = 500;
      ctx.body = { success: false, error: { message: String(err) } };
    }
  });

  // ==================== GET THREAD ====================
  router.get('/chat/threads/:id', async (ctx) => {
    try {
      const id = ctx.params.id;
      const store = await ThreadStore.getInstance();
      const thread = await store.get(id);

      if (!thread) {
        ctx.status = 404;
        ctx.body = { success: false, error: { message: 'Thread not found' } };
        return;
      }

      const response: ApiResponse<ThreadDefinition> = {
        success: true,
        data: thread
      };
      ctx.body = response;
    } catch (err) {
      log.error(`Failed to get thread ${ctx.params.id}:`, err);
      ctx.status = 500;
      ctx.body = { success: false, error: { message: String(err) } };
    }
  });

  // ==================== SEND MESSAGE (SSE) ====================
  router.post('/chat/threads/:id/messages', async (ctx) => {
    try {
      const threadId = ctx.params.id;
      const body = ctx.request.body as {
        message: string;
      };

      if (!body.message) {
        ctx.status = 400;
        ctx.body = { success: false, error: { message: 'message is required' } };
        return;
      }

      const threadStore = await ThreadStore.getInstance();
      const thread = await threadStore.get(threadId);

      if (!thread) {
        ctx.status = 404;
        ctx.body = { success: false, error: { message: 'Thread not found' } };
        return;
      }

      const agentStore = AgentStore.getInstance();
      const agent = await agentStore.get(thread.agentId);

      if (!agent) {
        ctx.status = 404;
        ctx.body = { success: false, error: { message: `Agent ${thread.agentId} not found` } };
        return;
      }

      // 设置 SSE 响应头
      ctx.request.socket.setTimeout(0);
      ctx.req.socket.setNoDelay(true);
      ctx.req.socket.setKeepAlive(true);

      ctx.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      });

      const stream = new PassThrough();
      ctx.status = 200;
      ctx.body = stream;

      // 组装 Builder
      // sessionMode('file'): 启用完整流程
      //   1. 文件持久化: workspaces/{threadId}/sessions/*.jsonl
      //   2. EventBus 广播: 通过 WebSocket 推送到前端（实时监听）
      //   3. SSE 流式返回: 通过 HTTP Response 返回给 API 客户端
      // 注意：不使用 lightweight(true)，确保所有路径都走完整流程

      // 模型选择优先级：thread.overrideModel > agent.model > 全局默认
      // 如果都没有，AgentExecutor 会使用全局默认模型（来自 coobee.json5）
      //
      // 统一配置访问示例：
      //   import { Models } from '@main/config';
      //   const { provider, model } = Models.resolveModel(thread.overrideModel || agent.model);
      //   // provider.baseUrl, model.maxOutputTokens 等完整信息
      // P1 重构：使用 ThreadExecutionFactory 统一 Builder 配置
      const factory = ThreadExecutionFactory.getInstance(agentExecutor);
      const runConfig = await factory.createRunConfig({
        threadId: thread.id,
        sessionMode: 'file'
      });

      // 启动 AgentExecutor（完整流程：持久化 + WebSocket + SSE）
      const gen = agentExecutor.stream({
        sessionId: thread.id,
        message: body.message,
        ...runConfig
      });

      // 异步处理流
      (async () => {
        try {
          for await (const chunk of gen) {
            // 将 chunk 转换为 SSE 格式
            stream.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
          stream.write(`event: done\ndata: [DONE]\n\n`);
        } catch (err) {
          log.error(`[ChatRoutes] Stream error for thread ${thread.id}:`, err);
          stream.write(`event: error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`);
        } finally {
          stream.end();
        }
      })();
    } catch (err) {
      log.error(`Failed to send message to thread ${ctx.params.id}:`, err);
      if (!ctx.headerSent) {
        ctx.status = 500;
        ctx.body = { success: false, error: { message: String(err) } };
      }
    }
  });
}
