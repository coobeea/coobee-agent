/**
 * 流式输出类型定义
 *
 * 核心数据类型（StreamMessage、StreamSource）
 * 统一定义在 @shared/stream-protocol.ts，前后端共享。
 * 本文件重新导出并补充后端专用的 EventBus 事件类型。
 */

import type { StreamSource as _StreamSource, StreamMessage as _StreamMessage } from '@shared/stream-protocol';

export type StreamSource = _StreamSource;
export type StreamMessage = _StreamMessage;

/**
 * 流式事件类型
 */
export enum StreamEventType {
  /** 消息块 */
  MESSAGE = 'stream:message',

  /** 流开始 */
  START = 'stream:start',

  /** 流结束 */
  END = 'stream:end',

  /** 流错误 */
  ERROR = 'stream:error'
}

/**
 * 流式事件数据
 */
export interface StreamEvent {
  /** 事件类型 */
  type: StreamEventType;

  /** 会话 ID */
  sessionId: string;

  /** 消息数据（MESSAGE 事件） */
  message?: StreamMessage;

  /** 来源信息（START/END/ERROR 事件） */
  source?: StreamSource;

  /** 错误信息（ERROR 事件） */
  error?: string;

  /** 事件时间戳 */
  timestamp: number;
}

export interface UsageRecord {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** 当前模型上下文窗口大小，保留最后一次 LLM 调用的值 */
  contextWindow?: number;
}

export interface ToolCallRecord {
  name: string;
  callId: string;
  arguments?: unknown;
  result?: string;
  status: 'calling' | 'done' | 'error';
  startTime: string;
  endTime?: string;
}

export interface TurnRecord {
  index: number;
  startTime: string;
  endTime?: string;
  status: 'running' | 'done' | 'error' | 'interrupted';
  reasoning: string;
  content: string;
  toolCalls: ToolCallRecord[];
  usage: UsageRecord;
}

export interface HistoryAssistantMessageV2 {
  version: 2;
  id: string;
  role: 'assistant';
  timestamp: string;
  startTime: string;
  endTime?: string;
  status: 'running' | 'done' | 'error' | 'interrupted';
  content: string;
  turns: TurnRecord[];
  usage: UsageRecord;
  error?: string;
}
