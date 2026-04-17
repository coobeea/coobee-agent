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
   *
   * 返回格式：
   * {
   *   threads: [
   *     { id, title, agentId, status, runStatus, ... },
   *     ...
   *   ]
   * }
   */
  router.get('/threads', async (ctx) => {
    try {
      const { agentId } = ctx.query;
      const store = await ThreadStore.getInstance();
      
      const threads = await store.list({
        agentId: agentId as string | undefined
      });

      ctx.body = { threads };
      log.debug(`[GET /threads] 返回 ${threads.length} 个任务`);
    } catch (error) {
      log.error('[GET /threads] 错误:', error);
      ctx.status = 500;
      ctx.body = { error: error instanceof Error ? error.message : 'Internal server error' };
    }
  });

  /**
   * GET /gateway/threads/:threadId/history
   *
   * 获取 Thread 的历史消息（events.jsonl）
   *
   * 返回格式：
   * {
   *   events: [
   *     { ts: '2026-04-17T...', seq: 1, type: 'run:start', content: '', data: {...} },
   *     { ts: '2026-04-17T...', seq: 2, type: 'text:delta', content: 'Hello', data: {...} },
   *     ...
   *   ],
   *   userMessages: [
   *     { content: 'user input', timestamp: 123456 }
   *   ]
   * }
   */
  router.get('/threads/:threadId/history', async (ctx) => {
    const { threadId } = ctx.params;

    if (!threadId) {
      ctx.status = 400;
      ctx.body = { error: 'threadId is required' };
      return;
    }

    try {
      // 验证 thread 是否存在
      const store = await ThreadStore.getInstance();
      const thread = await store.get(threadId);

      if (!thread) {
        ctx.status = 404;
        ctx.body = { error: 'Thread not found' };
        return;
      }

      // 读取 events.jsonl
      const workspacePath = path.join(Env.paths.workspacesDir, threadId);
      const eventsFile = path.join(workspacePath, '.runtime', 'events', 'events.jsonl');

      let events: Record<string, unknown>[] = [];

      if (await fs.pathExists(eventsFile)) {
        const content = await fs.readFile(eventsFile, 'utf-8');
        events = content
          .split('\n')
          .filter((line) => line.trim())
          .map((line) => {
            try {
              return JSON.parse(line) as Record<string, unknown>;
            } catch {
              return null;
            }
          })
          .filter((event): event is Record<string, unknown> => event !== null);
      }

      // 提取用户消息（从 session 文件）
      log.debug(`[GET /threads/${threadId}/history] workspacePath: ${workspacePath}, sessionId: ${thread.sessionId}`);
      const userMessages = await extractUserMessages(workspacePath, thread.sessionId);
      log.debug(`[GET /threads/${threadId}/history] extracted ${userMessages.length} user messages`);

      ctx.body = {
        events,
        userMessages
      };

      log.debug(`[GET /threads/${threadId}/history] 返回 ${events.length} 条事件, ${userMessages.length} 条用户消息`);
    } catch (error) {
      log.error(`[GET /threads/${threadId}/history] 错误:`, error);
      ctx.status = 500;
      ctx.body = { error: error instanceof Error ? error.message : 'Internal server error' };
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
      const allowedFields = ['title', 'status', 'projectDir', 'overrideModel'];
      const filteredUpdates: Record<string, unknown> = {};

      for (const key of allowedFields) {
        if (key in updates) {
          filteredUpdates[key] = updates[key];
        }
      }

      // 更新 Thread
      const updatedThread = await store.update(id, filteredUpdates);

      ctx.body = { thread: updatedThread };
      log.debug(`[PATCH /threads/${id}] 更新成功`);
    } catch (error) {
      log.error(`[PATCH /threads/:id] 更新失败:`, error);
      ctx.status = 500;
      ctx.body = { error: error instanceof Error ? error.message : 'Internal server error' };
    }
  });

  log.info('[ThreadRoutes] 路由已注册');
}

/**
 * 从 session 文件中提取用户消息
 *
 * session 文件格式：.runtime/sessions/{sessionId}/*.jsonl
 * 每行是一个事件，包含 type、content、timestamp 等字段
 */
async function extractUserMessages(
  workspacePath: string,
  sessionId: string
): Promise<{ content: string; timestamp: number }[]> {
  const sessionsDir = path.join(workspacePath, '.runtime', 'sessions', sessionId);

  log.debug(`[extractUserMessages] sessionsDir: ${sessionsDir}, exists: ${await fs.pathExists(sessionsDir)}`);

  if (!(await fs.pathExists(sessionsDir))) {
    return [];
  }

  const files = await fs.readdir(sessionsDir);
  const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));
  
  log.debug(`[extractUserMessages] found ${jsonlFiles.length} session files`);

  const userMessages: { content: string; timestamp: number }[] = [];

  for (const file of jsonlFiles) {
    const filePath = path.join(sessionsDir, file);
    const content = await fs.readFile(filePath, 'utf-8');

    const lines = content.split('\n').filter((line) => line.trim());

    for (const line of lines) {
      try {
        const event = JSON.parse(line) as Record<string, unknown>;

        // 查找用户消息：type === 'message' 且 message.role === 'user'
        if (event.type === 'message') {
          const message = event.message as Record<string, unknown> | undefined;
          if (message?.role === 'user') {
            // 提取文本内容：message.content[0].text
            const content = message.content as Array<Record<string, unknown>> | undefined;
            const text = content?.[0]?.text as string | undefined;
            
            if (text) {
              userMessages.push({
                content: text,
                timestamp: (message.timestamp as number) || Date.now()
              });
            }
          }
        }
      } catch {
        // 忽略解析错误
      }
    }
  }

  // 按时间戳排序
  userMessages.sort((a, b) => a.timestamp - b.timestamp);

  return userMessages;
}
