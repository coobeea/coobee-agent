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
import { Env } from '@main/common/env';

const log = createLogger('thread-routes');

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
      const allThreads = await store.list({
        agentId: agentId as string | undefined
      });
      const total = allThreads.length;

      // 获取当前页数据
      const threads = await store.list({
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

      // 从 session 文件读取完整对话历史
      const workspacePath = path.join(Env.paths.workspacesDir, threadId);
      const messages = await extractMessagesFromSession(workspacePath, thread.sessionId);

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
      const updates = ctx.request.body as Record<string, unknown>;

      log.info(`[PATCH /threads/${id}] 更新 Thread:`, updates);

      const store = await ThreadStore.getInstance();
      const thread = await store.get(id);

      if (!thread) {
        ctx.status = 404;
        ctx.body = { error: 'Thread not found' };
        return;
      }

      // 只允许更新特定字段
      const allowedFields = ['title', 'status', 'projectDir', 'overrideModel', 'enableThinking'];
      const filteredUpdates: Record<string, unknown> = {};

      for (const key of allowedFields) {
        if (key in updates) {
          filteredUpdates[key] = updates[key];
        }
      }

      // 更新 Thread
      const updatedThread = await store.update(id, filteredUpdates);

      ctx.body = {
        success: true,
        data: { thread: updatedThread }
      };
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
async function extractMessagesFromSession(
  workspacePath: string,
  _sessionId: string
): Promise<Array<Record<string, unknown>>> {
  const historyFile = path.join(workspacePath, 'history.jsonl');

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
