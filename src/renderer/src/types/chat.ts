/**
 * 聊天相关类型定义
 */

/** 消息状态 */
export type MessageStatus = 'pending' | 'streaming' | 'done' | 'error';

/** 内容块类型 */
export type ContentBlockType = 'text' | 'thinking' | 'tool';

/** 工具调用状态 */
export type ToolCallStatus = 'calling' | 'approval-pending' | 'done' | 'error';

/** 工具调用信息 */
export interface ToolCall {
  /** 工具名称 */
  name?: string;
  /** 工具参数 */
  arguments?: string;
  /** 工具结果 */
  result?: string;
  /** 状态 */
  status: ToolCallStatus;
  /** 错误信息 */
  error?: string;
}

/** 内容块 */
export interface ContentBlock {
  /** 块类型 */
  type: ContentBlockType;
  /** 文本内容（text/thinking 类型） */
  text?: string;
  /** 工具调用（tool 类型） */
  tool?: ToolCall;
}

/** 流式聊天消息 */
export interface StreamChatMessage {
  /** 消息 ID */
  id: string;
  /** 角色 */
  role: 'user' | 'assistant';
  /** 内容块列表 */
  blocks: ContentBlock[];
  /** 消息状态 */
  status: MessageStatus;
  /** 时间戳 */
  timestamp: number;
}
