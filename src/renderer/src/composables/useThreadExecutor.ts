/**
 * useThreadExecutor
 *
 * “已有会话”的 Agent 请求组合式 API，把分散在各组件里的 `chat.*` RPC 调用
 * 集中到一处，避免 RPC 方法名散落与类型漂移。
 *
 * 设计约束：
 *   - 走 WebSocket RPC（`useGateway().request`），与流式 `stream:*` 事件对应。
 *   - 不渲染聊天消息、不替换 `chatStore.handleStreamMessage`；流式消息仍由
 *     `chatStore` 在 `stream:*` 事件上拼接。
 *   - 仅做“方法签名 + 参数裁剪 + 默认值”的薄封装。
 */

import { useGateway } from './useGateway';

/** Agent Runtime 类型（与后端 `ThreadRuntimeType` 对齐） */
export type ThreadRuntimeType = 'pi-mono' | 'openai' | 'claude';

/** `chat.createThread` 入参 */
export interface CreateThreadOptions {
  /** 会话标题，默认 '新会话' */
  title?: string;
  /** Agent ID，默认 'app-copilot' */
  agentId?: string;
  /** 覆盖 Agent 默认模型（provider/model 或 model id） */
  overrideModel?: string;
  /** Runtime 类型 */
  runtimeType?: ThreadRuntimeType;
  /** 是否启用思维链 */
  enableThinking?: boolean;
  /** 是否启用 ASR（语音输入） */
  asrEnabled?: boolean;
  /** 是否启用 TTS（语音输出） */
  ttsEnabled?: boolean;
}

/** `chat.sendMessage` 入参 */
export interface SendMessageOptions {
  /** 会话 ID */
  threadId: string;
  /** 消息内容（非空） */
  message: string;
  /** 可选：覆盖本次消息的 runtime 类型（当前后端已通过 Thread 配置决定，预留） */
  runtimeType?: ThreadRuntimeType;
}

/** `chat.createThread` 返回的最小结构（具体字段以后端 ThreadDefinition 为准） */
export interface ThreadHandle {
  id: string;
  title?: string;
  agentId?: string;
  [key: string]: unknown;
}

/** `chat.abortMessage` 返回 */
export interface AbortMessageResult {
  success: boolean;
  aborted: boolean;
}

/** `chat.sendMessage` 返回 */
export interface SendMessageResult {
  success: boolean;
}

/** 组合式 API 返回值 */
export interface ThreadExecutor {
  connectionState: ReturnType<typeof useGateway>['connectionState'];
  lastError: ReturnType<typeof useGateway>['lastError'];
  createThread: (options?: CreateThreadOptions) => Promise<ThreadHandle>;
  sendMessage: (options: SendMessageOptions) => Promise<SendMessageResult>;
  abortMessage: (threadId: string) => Promise<AbortMessageResult>;
}

/**
 * 创建一个绑定 Gateway 的 Thread 执行器。
 *
 * @example
 *   const thread = useThreadExecutor();
 *   const t = await thread.createThread({ title: '新的会话' });
 *   await thread.sendMessage({ threadId: t.id, message: '你好' });
 *   await thread.abortMessage(t.id);
 */
export function useThreadExecutor(): ThreadExecutor {
  const { connectionState, lastError, request } = useGateway();

  async function createThread(options: CreateThreadOptions = {}): Promise<ThreadHandle> {
    const params: Record<string, unknown> = {};
    if (options.title !== undefined) params.title = options.title;
    if (options.agentId !== undefined) params.agentId = options.agentId;
    if (options.overrideModel !== undefined) params.overrideModel = options.overrideModel;
    if (options.runtimeType !== undefined) params.runtimeType = options.runtimeType;
    if (options.enableThinking !== undefined) params.enableThinking = options.enableThinking;
    if (options.asrEnabled !== undefined) params.asrEnabled = options.asrEnabled;
    if (options.ttsEnabled !== undefined) params.ttsEnabled = options.ttsEnabled;
    return request<ThreadHandle>('chat.createThread', params);
  }

  async function sendMessage(options: SendMessageOptions): Promise<SendMessageResult> {
    const message = options.message?.trim();
    if (!message) {
      throw new Error('message is required and must be a non-empty string');
    }
    if (!options.threadId) {
      throw new Error('threadId is required');
    }
    const params: Record<string, unknown> = {
      threadId: options.threadId,
      message
    };
    if (options.runtimeType !== undefined) params.runtimeType = options.runtimeType;
    return request<SendMessageResult>('chat.sendMessage', params);
  }

  async function abortMessage(threadId: string): Promise<AbortMessageResult> {
    if (!threadId) {
      throw new Error('threadId is required');
    }
    return request<AbortMessageResult>('chat.abortMessage', { threadId });
  }

  return {
    connectionState,
    lastError,
    createThread,
    sendMessage,
    abortMessage
  };
}
