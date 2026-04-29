/**
 * emit_event — 事件发送工具
 *
 * 允许 Agent 在运行过程中向前端发送事件，触发 UI 交互。
 * 事件通过 Gateway WebSocket 广播给所有连接的前端客户端。
 *
 * 典型场景：
 *   - Agent 启动 dev server 后通知前端打开网页预览
 *   - Agent 生成了文件后通知前端打开查看
 *   - 任何需要前端配合执行的交互场景
 *
 * 预定义事件类型：
 *   - open-preview: 在工作台打开 URL 预览（iframe）
 *   - open-file:    在工作台打开文件
 *   - notify:       向用户显示通知消息
 *
 * 分类：Observability | 风险：低（只读通知，不改变系统状态）
 */

import { z } from 'zod';
import type { ToolDefinition, ToolResult, ToolStreamUpdate, ToolExecutionContext } from '../types';
import { ToolCategory } from '../types';
import { eventBus } from '@main/common/eventbus';
import { AgentEventTypes, normalizeAgentMessage } from '@shared/events/agent';

export const emitEventTool: ToolDefinition = {
  name: 'emit_event',
  description:
    'Send a UI message to the user interface. The "event" parameter is the action name. ' +
    'The payload object only supports two top-level fields: "text" for human-readable text and "data" for structured parameters.\n' +
    '- "notify": Show a notification to the user\n' +
    '  payload: { text: "Task completed!", data: { level?: "info"|"success"|"warning"|"error" } }\n' +
    '- "open-preview": Open a URL preview in the workbench\n' +
    '  payload: { text?: "My App", data: { url: "http://localhost:3000" } }\n' +
    '- "open-file": Open a file in the workbench editor\n' +
    '  payload: { text?: "View file", data: { path: "/absolute/path/to/file" } }',
  category: ToolCategory.Observability,
  needUserConfirm: false,
  parameters: z.object({
    event: z.string().describe('Action name: "notify", "open-preview", or "open-file"'),
    payload: z
      .object({
        text: z.string().optional().describe('Human-readable text, such as notification content or tab title'),
        data: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Structured action parameters, such as url/path/level')
      })
      .strict()
      .optional()
      .describe('Message payload with only text and data fields.')
  }),

  execute: async function* (
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    context?: ToolExecutionContext
  ): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    const event = typeof params.event === 'string' ? params.event : '';

    if (!event.trim()) {
      return {
        success: false,
        llmContent: 'Error: event must be one of notify, open-preview, or open-file.',
        error: { code: 'INVALID_PARAM', message: 'event must be a non-empty string' }
      };
    }

    const message = normalizeAgentMessage(event, params.payload, {
      sessionId: context?.sessionId,
      agentName: context?.agentName
    });

    if ('error' in message) {
      return {
        success: false,
        llmContent:
          `Error: ${message.error}.\n` +
          'Supported examples:\n' +
          '- { event: "notify", payload: { text: "Task completed", data: { level: "success" } } }\n' +
          '- { event: "open-preview", payload: { text: "Preview", data: { url: "http://localhost:3000" } } }\n' +
          '- { event: "open-file", payload: { text: "View file", data: { path: "/absolute/path/to/file" } } }',
        error: { code: 'INVALID_PARAM', message: message.error }
      };
    }

    eventBus.emit(AgentEventTypes.MESSAGE, message);

    yield { type: 'progress', content: `UI action "${message.action}" sent`, percentage: 100 };

    return {
      success: true,
      llmContent: `UI action "${message.action}" has been sent to the user interface.`,
      userContent: message.action,
      metadata: {
        action: message.action,
        payload: message.payload,
        meta: message.meta,
        timestamp: message.timestamp
      }
    };
  }
};
