/**
 * Chat 相关类型定义
 */

import type { HitlApprovalDecision } from '@shared/stream-protocol';

/**
 * 工具调用信息
 */
export interface ToolCallInfo {
  name: string;
  callId?: string;
  arguments?: unknown;
  result?: unknown;
  status: 'calling' | 'done' | 'error' | 'approval-pending';
  updates?: ToolOutputEntry[];
}

/**
 * 上下文压缩信息
 */
export interface CompressionInfo {
  status: 'compressing' | 'done' | 'error';
  reason?: string;
  error?: string;
}

/**
 * HITL 审批信息
 */
export interface PendingApproval {
  index: number;
  toolName: string;
  arguments?: string;
  decision?: HitlApprovalDecision;
  /** 审批所属的 session（支持子 Agent），缺省为当前 thread */
  sessionId?: string;
  /** 是否可以显示（必须等到 run:done 后） */
  canShow?: boolean;
}

/**
 * 执行输出条目
 */
export interface ExecOutputEntry {
  timestamp: number;
  type: 'progress' | 'output' | 'result';
  toolName: string;
  content: string;
}

/**
 * 工具执行过程展示条目
 */
export interface ToolOutputEntry {
  timestamp: number;
  type: 'progress' | 'output' | 'result';
  content: string;
}

/**
 * 内容块类型
 */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool'; tool: ToolCallInfo }
  | { type: 'compression'; compression: CompressionInfo }
  | { type: 'audio'; src: string; title?: string };

/**
 * 消息状态
 */
export type MessageStatus = 'sending' | 'streaming' | 'done' | 'error' | 'interrupted';

/**
 * 执行统计信息（一轮对话的统计）
 */
export interface ExecutionStats {
  /** 输入 token 总数 */
  inputTokens: number;
  /** 输出 token 总数 */
  outputTokens: number;
  /** 总 token 数 */
  totalTokens: number;
  /** 当前模型上下文窗口大小，保留最后一次 LLM 调用的值 */
  contextWindow?: number;
  /** 最后一次 LLM 调用的输入 token，用于计算当前上下文占比 */
  contextInputTokens?: number;
  /** 大模型调用次数 */
  llmCalls: number;
  /** 工具调用次数 */
  toolCalls: number;
  /** 开始时间戳 */
  startTime: number;
  /** 结束时间戳（完成时才有） */
  endTime?: number;
  /** 总耗时（毫秒） */
  duration?: number;
  /** 输出速率（tokens/秒） */
  tokensPerSecond?: number;
}

export interface HistoryUsageV2 {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextWindow?: number;
}

export interface HistoryToolCallV2 {
  name: string;
  callId: string;
  arguments?: unknown;
  result?: string;
  status: 'calling' | 'done' | 'error';
  startTime: string;
  endTime?: string;
}

export interface HistoryTurnV2 {
  index: number;
  startTime: string;
  endTime?: string;
  status: 'running' | 'done' | 'error' | 'interrupted';
  reasoning: string;
  content: string;
  toolCalls: HistoryToolCallV2[];
  usage: HistoryUsageV2;
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
  turns: HistoryTurnV2[];
  usage: HistoryUsageV2;
  error?: string;
}

/**
 * 流式聊天消息（UI 可渲染）
 */
export interface StreamChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  blocks: ContentBlock[];
  pendingApprovals?: PendingApproval[];
  status: MessageStatus;
  error?: string;
  timestamp: number;
  /** 执行统计信息（仅 assistant 消息） */
  stats?: ExecutionStats;
}

// 兼容旧的类型别名
export type { ToolCallInfo as ToolCall };
export type ContentBlockType = ContentBlock['type'];
export type ToolCallStatus = ToolCallInfo['status'];
