/**
 * Chat Store
 *
 * 管理多个 thread 的队列状态（是否正在流式响应）。
 * 每个 thread 的消息列表由组件本地管理（通过 useStreamHandler）。
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';

/** 流状态 */
interface StreamState {
  /** 是否正在流式响应 */
  isStreaming: boolean;
  /** 当前消息序号 */
  currentSequence: number;
}

export const useChatStore = defineStore('chat', () => {
  /** 各 thread 的流状态 */
  const streamStates = ref<Map<string, StreamState>>(new Map());

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

  return {
    streamStates,
    getState,
    setState,
    resetState
  };
});
