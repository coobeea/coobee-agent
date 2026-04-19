<script setup lang="ts">
/**
 * ChatPanel — 对话面板（全局 store 版）
 *
 * 消息由全局 chatStore 管理，组件只负责展示和交互。
 * 不需要手动订阅/退订，流式消息自动更新。
 */

import { ref, computed, watch, onMounted, nextTick } from 'vue';
import { useChatStore } from '@/stores/chat';
import type { StreamMessage } from '@shared/stream-protocol';
import { useGateway } from '@/composables/useGateway';
import ChatMessages from '@/components/chat/ChatMessages.vue';
import ChatComposer from '@/components/chat/ChatComposer.vue';

// ==================== Props ====================
const props = withDefaults(
  defineProps<{
    threadId: string;
    /** sidebar: 右侧栏（左边框）；stacked: 主列内上下堆叠（上边框） */
    borderVariant?: 'sidebar' | 'stacked';
  }>(),
  { borderVariant: 'sidebar' }
);

// ==================== Store & Composables ====================
const chatStore = useChatStore();
const { request } = useGateway();

// ==================== Refs ====================
const chatMessagesRef = ref<InstanceType<typeof ChatMessages> | null>(null);
const chatComposerRef = ref<InstanceType<typeof ChatComposer> | null>(null);

// ==================== Computed ====================
// 直接从 store 读取消息（自动响应式）
const messages = computed(() => chatStore.getThreadMessages(props.threadId));
const isStreaming = computed(() => chatStore.getState(props.threadId).isStreaming);

// ==================== Methods ====================
function scrollToBottom(force = false): void {
  chatMessagesRef.value?.scrollToBottom(force);
}

function insertFileReference(file: { path: string; name: string }): void {
  chatComposerRef.value?.insertFileReference?.(file);
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
    return (last.content?.length ?? 0) + (last.blocks?.length ?? 0) * 1000;
  },
  () => scrollToBottom()
);

async function handleSend(data: { text: string; files?: { path: string; name: string }[] }): Promise<void> {
  if (!data.text) return;

  scrollToBottom(true);

  // 添加用户消息到 store
  chatStore.addUserMessage(props.threadId, data.text);

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

// ==================== 历史加载 ====================

async function loadThreadHistory(): Promise<void> {
  // 如果 store 里已经有消息，说明是实时接收的，不需要再加载历史
  if (messages.value.length > 0) {
    return;
  }

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

    let userIdx = 0;

    // 重放历史事件到 store
    for (const evt of history.events) {
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

      // 在 run:start 前插入用户消息
      if (evt.type === 'run:start' && userIdx < history.userMessages.length) {
        chatStore.addUserMessage(props.threadId, history.userMessages[userIdx].content);
        userIdx++;
      }

      // 交给 store 处理
      chatStore.handleStreamMessage(streamMsg);
    }

    await nextTick();
    scrollToBottom(true);
  } catch (err: unknown) {
    console.error('[ChatPanel] loadThreadHistory error:', err);
  }
}

// ==================== 生命周期 ====================
onMounted(async () => {
  scrollToBottom();
  await loadThreadHistory();
});

// 监听 threadId 变化（切换会话时重新加载）
watch(
  () => props.threadId,
  async (newThreadId, oldThreadId) => {
    if (newThreadId !== oldThreadId) {
      await loadThreadHistory();
    }
  }
);

defineExpose({
  insertFileReference
});
</script>

<template>
  <aside class="chat-panel" :class="props.borderVariant === 'stacked' ? 'chat-panel--stacked' : ''">
    <!-- 消息区域 -->
    <ChatMessages ref="chatMessagesRef" :messages="messages" :is-streaming="isStreaming" />

    <!-- 输入区：模型选择 + 富文本输入（可复用 ChatComposer） -->
    <ChatComposer
      ref="chatComposerRef"
      :thread-id="threadId"
      :disabled="isStreaming"
      :placeholder="isStreaming ? '智能体正在处理中...' : '输入消息，Enter 发送，Shift+Enter 换行'"
      :show-stop-button="isStreaming"
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
  padding: 12px;
  background: hsl(var(--background));
  border-left: 1px solid hsl(var(--border) / 0.4);
}

.chat-panel--stacked {
  border-left: none;
  border-top: 1px solid hsl(var(--border) / 0.4);
}
</style>
