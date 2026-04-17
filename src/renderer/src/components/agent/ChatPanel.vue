<script setup lang="ts">
/**
 * ChatPanel — 对话面板（重构版）
 *
 * Agent 的对话交互区域：消息流、工具调用。
 * messages 由组件本地持有（useStreamHandler），unmounted 时自动释放。
 */

import { ref, provide, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useChatStore } from '@/stores/chat';
import { useStreamHandler } from '@/composables/useStreamHandler';
import { streamSubscribe, streamUnsubscribe } from '@/composables/useStreamWs';
import type { StreamMessage } from '@shared/stream-protocol';
import { useGateway } from '@/composables/useGateway';
import ChatMessages from '@/components/chat/ChatMessages.vue';
import ChatInput from '@/components/chat/ChatInput.vue';

// ==================== Props ====================
const props = defineProps<{
  threadId: string;
}>();

// ==================== Store & Composables ====================
const chatStore = useChatStore();
const { request } = useGateway();

// 使用 useStreamHandler 管理本地消息（组件级状态）
const { messages, isStreaming, execOutputs, handleStreamMessage, addUserMessage, resetAll } = useStreamHandler({
  idPrefix: 'chat',
  maxMessages: 500
});

// ==================== Refs ====================
const chatMessagesRef = ref<InstanceType<typeof ChatMessages> | null>(null);
const chatInputRef = ref<InstanceType<typeof ChatInput> | null>(null);
const isCollapsed = defineModel<boolean>('collapsed', { default: false });

// 提供 execOutputs 给子组件（如 TerminalPanel）
provide('execOutputs', execOutputs);

// ==================== Methods ====================
function scrollToBottom(force = false): void {
  chatMessagesRef.value?.scrollToBottom(force);
}

function insertFileReference(file: { path: string; name: string }): void {
  chatInputRef.value?.insertFileReference?.(file);
}

// 新消息到达 → 自动滚动
watch(
  () => messages.value.length,
  () => scrollToBottom()
);

// 流式内容增量更新 → 自动滚动
watch(
  () => {
    const msgs = messages.value;
    if (msgs.length === 0) return 0;
    const last = msgs[msgs.length - 1];
    if (!last) return 0;
    const blockCount = last.blocks?.length ?? 0;
    const lastBlock = blockCount > 0 && last.blocks ? last.blocks[blockCount - 1] : null;
    const lastLen = lastBlock && 'text' in lastBlock ? lastBlock.text?.length ?? 0 : 0;
    return (last.content?.length ?? 0) + blockCount * 1000 + lastLen;
  },
  () => scrollToBottom()
);

async function handleSend(data: { text: string; files?: { path: string; name: string }[] }): Promise<void> {
  if (!data.text) return;

  scrollToBottom(true);

  // 添加用户消息到本地
  addUserMessage(data.text);

  // 发送到后端（后端会推送流式事件）
  try {
    await request('chat.sendMessage', {
      threadId: props.threadId,
      message: data.text
    });
  } catch (error) {
    console.error('[ChatPanel] sendMessage error:', error);
  }
}

async function handleStop(): Promise<void> {
  console.log('[ChatPanel] handleStop called for thread:', props.threadId);
  try {
    await request('chat.abortMessage', {
      threadId: props.threadId
    });
  } catch (error) {
    console.error('[ChatPanel] abortMessage error:', error);
  }
}

// ==================== 流式消息处理包装 ====================

/**
 * 处理流式消息并同步 Store 的 isStreaming 状态
 */
function handleStreamMessageWithSync(msg: StreamMessage): void {
  // 更新本地消息
  handleStreamMessage(msg);

  // 同步 Store 的 isStreaming 状态
  if (msg.type === 'run:start') {
    chatStore.setState(props.threadId, true);
  } else if (msg.type === 'run:done' || msg.type === 'run:error') {
    chatStore.setState(props.threadId, false);
  }
}

// ==================== 订阅管理 ====================

let subscribedSessionId: string | null = null;

function ensureSubscription(): void {
  if (subscribedSessionId !== props.threadId) {
    if (subscribedSessionId) {
      streamUnsubscribe(subscribedSessionId, handleStreamMessageWithSync);
    }
    streamSubscribe(props.threadId, handleStreamMessageWithSync);
    subscribedSessionId = props.threadId;
  }
}

function unsubscribe(): void {
  if (subscribedSessionId) {
    streamUnsubscribe(subscribedSessionId, handleStreamMessageWithSync);
    subscribedSessionId = null;
  }
}

// ==================== 历史加载 ====================

async function loadThreadHistory(): Promise<void> {
  try {
    const baseUrl = import.meta.env.VITE_GATEWAY_BASE_URL || 'http://127.0.0.1:8765/gateway';
    const res = await fetch(`${baseUrl}/threads/${props.threadId}/history`);

    if (!res.ok) {
      console.warn('[ChatPanel] 历史加载失败:', res.statusText);
      return;
    }

    const history = (await res.json()) as {
      events: Array<{ ts: string; seq: number; type: string; content: string; data?: Record<string, unknown> }>;
      userMessages: Array<{ content: string; timestamp: number }>;
    };

    if (history.events.length === 0 && history.userMessages.length === 0) {
      return;
    }

    resetAll(); // 清空旧消息

    let userIdx = 0;

    for (const evt of history.events) {
      // 转换历史事件为 StreamMessage 格式
      const streamMsg: StreamMessage = {
        id: `hist-${evt.seq}`,
        sessionId: props.threadId,
        sequence: evt.seq,
        timestamp: new Date(evt.ts).getTime(),
        type: evt.type as StreamMessage['type'],
        content: evt.content,
        data: evt.data,
        source: { type: 'agent', id: props.threadId, name: '' }
      };

      switch (evt.type) {
        case 'run:start':
          if (userIdx < history.userMessages.length) {
            addUserMessage(history.userMessages[userIdx].content);
            userIdx++;
          }
          handleStreamMessage(streamMsg);
          break;

        default:
          // 其他历史事件通过 handleStreamMessage 处理
          handleStreamMessage(streamMsg);
          break;
      }
    }

    // 历史加载完成后，统一同步一次 Store 的 isStreaming 状态
    chatStore.setState(props.threadId, isStreaming.value);

    await nextTick();
    scrollToBottom(true);
  } catch (err: unknown) {
    console.error('[ChatPanel] loadThreadHistory error:', err);
  }
}

// ==================== 生命周期 ====================
onMounted(async () => {
  scrollToBottom();
  // 加载历史消息
  await loadThreadHistory();
  // 订阅流式更新
  ensureSubscription();
});

// 监听 threadId 变化（切换会话时重新加载）
watch(
  () => props.threadId,
  async (newThreadId, oldThreadId) => {
    if (newThreadId !== oldThreadId) {
      // 1. 取消旧订阅
      unsubscribe();
      // 2. 清空旧消息
      resetAll();
      // 3. 重新加载历史
      await loadThreadHistory();
      // 4. 重新订阅
      ensureSubscription();
    }
  }
);

onUnmounted(() => {
  unsubscribe();
});

defineExpose({
  insertFileReference
});
</script>

<template>
  <aside v-show="!isCollapsed" class="chat-panel">
    <!-- 折叠按钮 -->
    <button class="collapse-btn" title="折叠面板" @click="isCollapsed = true">
      <span class="i-carbon-chevron-right inline-block h-3 w-3"></span>
    </button>

    <!-- 消息区域 -->
    <ChatMessages
      ref="chatMessagesRef"
      :messages="messages"
      :is-streaming="isStreaming" />

    <!-- 输入区域 -->
    <ChatInput
      ref="chatInputRef"
      :disabled="isStreaming"
      :placeholder="isStreaming ? '智能体正在处理中...' : '输入消息...'"
      @send="handleSend"
      @stop="handleStop" />
  </aside>
</template>

<style scoped>
.chat-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: hsl(var(--background));
  border-left: 1px solid hsl(var(--border) / 0.4);
  position: relative;
}

.collapse-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: hsl(var(--muted-foreground) / 0.5);
  transition: all 0.15s ease;
  cursor: pointer;
}

.collapse-btn:hover {
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--foreground) / 0.7);
}
</style>
