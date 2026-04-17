/**
 * Chat Store
 *
 * 全局管理所有 thread 的消息和流状态。
 * 应用启动时自动监听流式消息并聚合存储。
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { StreamMessage } from '@shared/stream-protocol';
import type { StreamChatMessage } from '@/types/chat';
import { nanoid } from 'nanoid';

/** 流状态 */
interface StreamState {
  /** 是否正在流式响应 */
  isStreaming: boolean;
  /** 当前消息序号 */
  currentSequence: number;
}

/** Thread 消息状态 */
interface ThreadMessageState {
  /** 聚合后的消息列表 */
  messages: StreamChatMessage[];
  /** 当前正在构建的 assistant 消息 */
  currentAssistantMsg: StreamChatMessage | null;
}

const MAX_MESSAGES_PER_THREAD = 50;

export const useChatStore = defineStore('chat', () => {
  /** 各 thread 的流状态 */
  const streamStates = ref<Map<string, StreamState>>(new Map());

  /** 各 thread 的消息状态 */
  const threadMessageStates = ref<Map<string, ThreadMessageState>>(new Map());

  /**
   * 获取或创建 thread 的消息状态
   */
  function getOrCreateThreadState(threadId: string): ThreadMessageState {
    let state = threadMessageStates.value.get(threadId);
    if (!state) {
      state = {
        messages: [],
        currentAssistantMsg: null
      };
      threadMessageStates.value.set(threadId, state);
    }
    return state;
  }

  /**
   * 获取 thread 的流状态
   */
  function getState(threadId: string): StreamState {
    let state = streamStates.value.get(threadId);
    if (!state) {
      state = { isStreaming: false, currentSequence: 0 };
      streamStates.value.set(threadId, state);
    }
    return state;
  }

  /**
   * 设置 thread 的流状态
   */
  function setState(threadId: string, isStreaming: boolean, sequence?: number): void {
    const state = getState(threadId);
    state.isStreaming = isStreaming;
    if (sequence !== undefined) {
      state.currentSequence = sequence;
    }
  }

  /**
   * 重置 thread 的流状态
   */
  function resetState(threadId: string): void {
    streamStates.value.delete(threadId);
  }

  /**
   * 添加用户消息
   */
  function addUserMessage(threadId: string, content: string): void {
    const threadState = getOrCreateThreadState(threadId);
    const userMsg: StreamChatMessage = {
      id: `msg-user-${nanoid(8)}`,
      role: 'user',
      content,
      blocks: [],
      status: 'done',
      timestamp: Date.now()
    };
    threadState.messages.push(userMsg);
    trimMessages(threadId);
  }

  /**
   * 处理流式消息（全局监听入口）- 聚合版本
   */
  function handleStreamMessage(msg: StreamMessage): void {
    const sessionId = msg.sessionId;
    const threadState = getOrCreateThreadState(sessionId);

    switch (msg.type) {
      case 'run:start':
        // 创建新的 assistant 消息
        threadState.currentAssistantMsg = {
          id: `msg-assistant-${nanoid(8)}`,
          role: 'assistant',
          content: '',
          blocks: [],
          status: 'streaming',
          timestamp: Date.now()
        };
        threadState.messages.push(threadState.currentAssistantMsg);
        setState(sessionId, true, msg.sequence);
        break;

      case 'text:delta': {
        // 累加文本到当前消息和 text block
        if (!threadState.currentAssistantMsg) break;

        threadState.currentAssistantMsg.content += msg.content || '';

        // 同时更新 text block（前端通过 blocks 渲染）
        let textBlock = threadState.currentAssistantMsg.blocks.find((b) => b.type === 'text') as
          | { type: 'text'; text: string }
          | undefined;
        if (!textBlock) {
          textBlock = { type: 'text', text: '' };
          threadState.currentAssistantMsg.blocks.push(textBlock);
        }
        textBlock.text += msg.content || '';
        break;
      }

      case 'reasoning:delta': {
        // 思考过程（累积到 thinking block）
        if (!threadState.currentAssistantMsg) break;

        let thinkingBlock = threadState.currentAssistantMsg.blocks.find((b) => b.type === 'thinking') as
          | { type: 'thinking'; text: string }
          | undefined;
        if (!thinkingBlock) {
          thinkingBlock = { type: 'thinking', text: '' };
          threadState.currentAssistantMsg.blocks.push(thinkingBlock);
        }
        thinkingBlock.text += msg.content || '';
        break;
      }

      case 'run:done':
        // 标记消息完成
        if (threadState.currentAssistantMsg) {
          threadState.currentAssistantMsg.status = 'done';
          threadState.currentAssistantMsg = null;
        }
        setState(sessionId, false, msg.sequence);
        trimMessages(sessionId);
        break;

      case 'run:error':
        // 标记消息错误
        if (threadState.currentAssistantMsg) {
          threadState.currentAssistantMsg.status = 'error';
          threadState.currentAssistantMsg.error = msg.content || '执行出错';
          threadState.currentAssistantMsg = null;
        }
        setState(sessionId, false, msg.sequence);
        break;

      // 其他类型暂时忽略，以后再加
      default:
        break;
    }
  }

  /**
   * 限制消息数量
   */
  function trimMessages(threadId: string): void {
    const threadState = threadMessageStates.value.get(threadId);
    if (!threadState) return;

    if (threadState.messages.length > MAX_MESSAGES_PER_THREAD) {
      threadState.messages.shift(); // 删除最旧的
    }
  }

  /**
   * 获取 thread 的消息列表
   */
  function getThreadMessages(threadId: string): StreamChatMessage[] {
    const threadState = threadMessageStates.value.get(threadId);
    return threadState?.messages || [];
  }

  /**
   * 清空 thread 的消息
   */
  function clearThreadMessages(threadId: string): void {
    threadMessageStates.value.delete(threadId);
    resetState(threadId);
  }

  return {
    streamStates,
    threadMessageStates,
    getState,
    setState,
    resetState,
    addUserMessage,
    handleStreamMessage,
    getThreadMessages,
    clearThreadMessages
  };
});
