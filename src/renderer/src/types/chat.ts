/**
 * Chat 相关类型定义
 */

import type { HitlApprovalDecision } from '@shared/stream-protocol';

/**
 * 工具调用信息
 */
export interface ToolCallInfo {
  name?: string;
  arguments?: string;
  result?: string;
  status: 'calling' | 'done' | 'error' | 'approval-pending';
}

/**
 * 委派信息
 */
export interface DelegateInfo {
  agentId: string;
  agentName?: string;
  task?: string;
  status: 'running' | 'done';
  output?: string;
  duration?: number;
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
 * 内容块类型
 */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool'; tool: ToolCallInfo }
  | { type: 'delegate'; delegate: DelegateInfo }
  | { type: 'quality'; status: string; detail?: string }
  | { type: 'audio'; src: string; title?: string };

/**
 * 消息状态
 */
export type MessageStatus = 'sending' | 'streaming' | 'done' | 'error' | 'interrupted';

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
}

// 兼容旧的类型别名
export type { ToolCallInfo as ToolCall };
export type ContentBlockType = ContentBlock['type'];
export type ToolCallStatus = ToolCallInfo['status'];
