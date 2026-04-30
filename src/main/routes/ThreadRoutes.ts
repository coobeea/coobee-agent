/**
 * Thread HTTP 路由
 *
 * 提供 Thread 历史消息查询接口。
 */

import type Router from '@koa/router';
import { ThreadStore } from '@main/agent/threads/ThreadStore';
import { createLogger } from '@main/common/logger';
import fs from 'fs-extra';
import path from 'path';
import type { UpdateThreadParams } from '@main/agent/threads/types';
import { ensureAgentRuntimeLayout, migrateLegacyThreadWorkspace } from '@main/agent/context/AgentRuntimeLayout';
import type { ApiResponse, DeleteThreadRespVO, UpdateThreadReqVO, UpdateThreadRespVO } from '@shared/api/thread-types';
import type { ThreadRuntimeType, ThreadStatus } from '@shared/events/thread';

const log = createLogger('thread-routes');

const THREAD_STATUSES = new Set<ThreadStatus>(['active', 'archived', 'deleted']);
const THREAD_RUNTIME_TYPES = new Set<ThreadRuntimeType>(['pi-mono', 'openai', 'claude']);

function isThreadStatus(value: unknown): value is ThreadStatus {
  return typeof value === 'string' && THREAD_STATUSES.has(value as ThreadStatus);
}

function isThreadRuntimeType(value: unknown): value is ThreadRuntimeType {
  return typeof value === 'string' && THREAD_RUNTIME_TYPES.has(value as ThreadRuntimeType);
}

function collectThreadUpdates(body: Record<string, unknown>): { updates?: UpdateThreadParams; error?: string } {
  const updates: UpdateThreadParams = {};

  if ('title' in body) {
    if (typeof body.title !== 'string') return { error: 'title must be a string' };
    updates.title = body.title;
  }
  if ('status' in body) {
    if (!isThreadStatus(body.status)) return { error: 'status is invalid' };
    updates.status = body.status;
  }
  if ('overrideModel' in body) {
    if (body.overrideModel !== null && typeof body.overrideModel !== 'string') {
      return { error: 'overrideModel must be a string or null' };
    }
    updates.overrideModel = body.overrideModel;
  }
  if ('runtimeType' in body) {
    if (!isThreadRuntimeType(body.runtimeType)) return { error: 'runtimeType is invalid' };
    updates.runtimeType = body.runtimeType;
  }
  if ('enableThinking' in body) {
    if (typeof body.enableThinking !== 'boolean') return { error: 'enableThinking must be a boolean' };
    updates.enableThinking = body.enableThinking;
  }
  if ('asrEnabled' in body) {
    if (typeof body.asrEnabled !== 'boolean') return { error: 'asrEnabled must be a boolean' };
    updates.asrEnabled = body.asrEnabled;
  }
  if ('ttsEnabled' in body) {
    if (typeof body.ttsEnabled !== 'boolean') return { error: 'ttsEnabled must be a boolean' };
    updates.ttsEnabled = body.ttsEnabled;
  }

  return { updates };
}

/**
 * 注册 Thread 路由
 */
export function registerThreadRoutes(router: Router): void {
  /**
   * GET /gateway/threads
   *
   * 获取 Thread 列表
   *
   * Query 参数：
   *   - agentId: 可选，按 Agent 过滤
   *   - offset: 可选，分页偏移量，默认 0
   *   - limit: 可选，每页数量，默认 50
   *
   * 返回格式：
   * {
   *   threads: [
   *     { id, title, agentId, status, runStatus, ... },
   *     ...
   *   ],
   *   pagination: {
   *     offset: 0,
   *     limit: 50,
   *     total: 123
   *   }
   * }
   */
  router.get('/threads', async (ctx) => {
    try {
      const { agentId, offset, limit } = ctx.query;
      const store = await ThreadStore.getInstance();

      // 解析分页参数
      const offsetNum = offset ? parseInt(offset as string, 10) : 0;
      const limitNum = limit ? parseInt(limit as string, 10) : 50;

      // 获取总数（用于返回分页信息）
      const allThreads = await store.listAsync({
        agentId: agentId as string | undefined
      });
      const total = allThreads.length;

      // 获取当前页数据
      const threads = await store.listAsync({
        agentId: agentId as string | undefined,
        offset: offsetNum,
        limit: limitNum
      });

      ctx.body = {
        success: true,
        data: {
          threads,
          pagination: {
            offset: offsetNum,
            limit: limitNum,
            total
          }
        }
      };
      log.debug(`[GET /threads] 返回 ${threads.length} 个任务 (总数: ${total})`);
    } catch (error) {
      log.error('[GET /threads] 错误:', error);
      ctx.status = 500;
      ctx.body = {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      };
    }
  });

  /**
   * GET /gateway/threads/:threadId/history
   *
   * 获取 Thread 的历史消息（从 session 文件）
   *
   * 返回格式：
   * {
   *   messages: [
   *     {
   *       role: 'user',
   *       content: [{ type: 'text', text: '...' }],
   *       timestamp: 123456
   *     },
   *     {
   *       role: 'assistant',
   *       content: [
   *         { type: 'thinking', thinking: '...' },
   *         { type: 'text', text: '...' }
   *       ],
   *       timestamp: 123457,
   *       usage: { ... }
   *     },
   *     ...
   *   ]
   * }
   */
  router.get('/threads/:threadId/history', async (ctx) => {
    const { threadId } = ctx.params;

    if (!threadId) {
      ctx.status = 400;
      ctx.body = { success: false, error: 'threadId is required' };
      return;
    }

    try {
      // 验证 thread 是否存在
      const store = await ThreadStore.getInstance();
      const thread = await store.get(threadId);

      if (!thread) {
        ctx.status = 404;
        ctx.body = { success: false, error: 'Thread not found' };
        return;
      }

      // 从 Agent Home 内的 session 目录读取完整对话历史
      const layout = await ensureAgentRuntimeLayout({
        agentId: thread.agentId,
        sessionId: thread.sessionId,
        agentHomePath: thread.agentHomePath
      });
      await migrateLegacyThreadWorkspace(thread.sessionId, layout.sessionDir);
      const messages = await extractMessagesFromSession(layout.sessionDir);

      ctx.body = {
        success: true,
        data: {
          messages
        }
      };

      log.debug(`[GET /threads/${threadId}/history] 返回 ${messages.length} 条消息`);
    } catch (error) {
      log.error(`[GET /threads/${threadId}/history] 错误:`, error);
      ctx.status = 500;
      ctx.body = {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      };
    }
  });

  /**
   * PATCH /gateway/threads/:id - 更新 Thread 属性
   */
  router.patch('/threads/:id', async (ctx) => {
    try {
      const { id } = ctx.params;
      const updates = ctx.request.body as UpdateThreadReqVO & Record<string, unknown>;

      log.info(`[PATCH /threads/${id}] 更新 Thread:`, updates);

      const store = await ThreadStore.getInstance();
      const thread = await store.get(id);

      if (!thread) {
        ctx.status = 404;
        ctx.body = { success: false, error: 'Thread not found' };
        return;
      }

      const { updates: filteredUpdates, error } = collectThreadUpdates(updates);
      if (error || !filteredUpdates) {
        ctx.status = 400;
        ctx.body = { success: false, error: error || 'Invalid request body' };
        return;
      }

      // 更新 Thread
      await store.update(id, filteredUpdates);
      const updatedThread = await store.getEntry(id);
      if (!updatedThread) {
        ctx.status = 404;
        ctx.body = { success: false, error: 'Thread not found' };
        return;
      }

      const response: ApiResponse<UpdateThreadRespVO> = {
        success: true,
        data: { thread: updatedThread }
      };
      ctx.body = response;
      log.debug(`[PATCH /threads/${id}] 更新成功`);
    } catch (error) {
      log.error(`[PATCH /threads/:id] 更新失败:`, error);
      ctx.status = 500;
      ctx.body = {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      };
    }
  });

  /**
   * DELETE /gateway/threads/:id - 删除 Thread
   */
  router.delete('/threads/:id', async (ctx) => {
    const { id } = ctx.params;

    if (!id) {
      ctx.status = 400;
      const response: ApiResponse = {
        success: false,
        error: 'thread id is required'
      };
      ctx.body = response;
      return;
    }

    try {
      const store = await ThreadStore.getInstance();
      const thread = await store.get(id);

      if (!thread) {
        ctx.status = 404;
        const response: ApiResponse = {
          success: false,
          error: 'Thread not found'
        };
        ctx.body = response;
        return;
      }

      if (thread.runStatus === 'running') {
        ctx.status = 409;
        const response: ApiResponse = {
          success: false,
          error: 'Thread is running and cannot be deleted'
        };
        ctx.body = response;
        return;
      }

      const deleted = await store.delete(id);
      if (!deleted) {
        ctx.status = 500;
        const response: ApiResponse = {
          success: false,
          error: 'Failed to delete thread'
        };
        ctx.body = response;
        return;
      }

      const response: ApiResponse<DeleteThreadRespVO> = {
        success: true,
        data: { threadId: id, deleted: true }
      };
      ctx.body = response;
      log.info(`[DELETE /threads/${id}] 删除成功`);
    } catch (error) {
      log.error(`[DELETE /threads/:id] 删除失败:`, error);
      ctx.status = 500;
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      };
      ctx.body = response;
    }
  });

  log.info('[ThreadRoutes] 路由已注册');
}

/**
 * 从 session 文件中提取完整的对话消息
 *
 * session 文件格式：sessions/{sessionId}/*.jsonl
 * 每行是一个事件，type === 'message' 的事件包含完整的消息内容
 *
 * @returns 完整的对话消息列表（用户 + AI）
 */
async function extractMessagesFromSession(sessionDir: string): Promise<Array<Record<string, unknown>>> {
  const historyFile = path.join(sessionDir, 'history.jsonl');

  log.debug(`[extractMessagesFromSession] historyFile: ${historyFile}, exists: ${await fs.pathExists(historyFile)}`);

  if (!(await fs.pathExists(historyFile))) {
    log.debug(`[extractMessagesFromSession] history.jsonl not found, returning empty array`);
    return [];
  }

  const messages: Array<Record<string, unknown>> = [];

  try {
    const content = await fs.readFile(historyFile, 'utf-8');
    const lines = content.split('\n').filter((line) => line.trim());

    for (const line of lines) {
      try {
        const message = JSON.parse(line) as Record<string, unknown>;
        messages.push(message);
      } catch (err) {
        log.warn(`[extractMessagesFromSession] Failed to parse line in history.jsonl:`, err);
      }
    }

    log.debug(`[extractMessagesFromSession] Loaded ${messages.length} aggregated messages from history.jsonl`);
  } catch (err) {
    log.error(`[extractMessagesFromSession] Failed to read history.jsonl:`, err);
  }

  return messages;
}
