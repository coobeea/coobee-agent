<script setup lang="ts">
/**
 * ChatMessages — 消息列表容器
 *
 * 负责渲染消息列表，区分用户消息和 AI 消息。
 */

import { ref, watch, nextTick } from 'vue';
import type { StreamChatMessage } from '@/types/chat';
import MessageItemUser from './MessageItemUser.vue';
import MessageItemAssistant from './MessageItemAssistant.vue';

const props = defineProps<{
  messages: StreamChatMessage[];
  isStreaming?: boolean;
}>();

const containerRef = ref<HTMLElement | null>(null);

/**
 * 滚动到底部
 */
async function scrollToBottom(): Promise<void> {
  await nextTick();
  if (containerRef.value) {
    containerRef.value.scrollTop = containerRef.value.scrollHeight;
  }
}

// 监听消息变化，自动滚动到底部
watch(
  () => props.messages.length,
  () => {
    scrollToBottom();
  },
  { flush: 'post' }
);
</script>

<template>
  <div
    ref="containerRef"
    class="flex-1 overflow-y-auto p-4 flex flex-col gap-4 chat-messages-scrollbar">
    <!-- 空状态 -->
    <div
      v-if="messages.length === 0"
      class="flex flex-col items-center justify-center gap-3 flex-1 text-muted-foreground/40 text-[13px] text-center">
      <span class="i-carbon-chat inline-block h-12 w-12 opacity-10" />
      <p>开始与智能体对话</p>
    </div>

    <!-- 消息列表 -->
    <div
      v-for="message in messages"
      :key="message.id"
      class="animate-message-in">
      <MessageItemUser
        v-if="message.role === 'user'"
        :message="message" />
      <MessageItemAssistant
        v-else
        :message="message" />
    </div>

    <!-- 流式响应加载状态 -->
    <div
      v-if="isStreaming && messages[messages.length - 1]?.role === 'assistant'"
      class="flex items-center justify-center p-2 text-muted-foreground/50">
      <span class="i-carbon-renew inline-block h-3 w-3 animate-spin opacity-50" />
    </div>
  </div>
</template>

<style scoped>
@keyframes messageIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-message-in {
  animation: messageIn 0.2s ease;
}

.chat-messages-scrollbar::-webkit-scrollbar {
  width: 4px;
}

.chat-messages-scrollbar::-webkit-scrollbar-thumb {
  background: hsl(var(--foreground) / 0.1);
  border-radius: 4px;
}

.chat-messages-scrollbar::-webkit-scrollbar-thumb:hover {
  background: hsl(var(--foreground) / 0.2);
}
</style>
