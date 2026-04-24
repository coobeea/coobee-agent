<script setup lang="ts">
/**
 * ChatMessages — 统一对话消息列表组件
 *
 * 封装了优秀的消息排版布局，负责消息的整体渲染与自动滚动控制。
 */

import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import type { ContentBlock, ExecutionStats, PendingApproval } from '@/types/chat';
import type { HitlApprovalDecision } from '@shared/stream-protocol';
import MessageItemUser from './items/MessageItemUser.vue';
import MessageItemAssistant from './items/MessageItemAssistant.vue';
import MessageNavigator from './MessageNavigator.vue';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  blocks?: ContentBlock[];
  status?: string;
  timestamp: number;
  error?: string;
  pendingApprovals?: PendingApproval[];
  stats?: ExecutionStats;
}

const props = withDefaults(
  defineProps<{
    messages: ChatMessage[];
    isStreaming?: boolean;
    assistantName?: string;
  }>(),
  {
    isStreaming: false,
    assistantName: '智能体'
  }
);

const emit = defineEmits<{
  decide: [approval: PendingApproval, decision: HitlApprovalDecision];
}>();

const processingStartedAt = ref<number | null>(null);
const nowTick = ref(Date.now());
let processingTimer: ReturnType<typeof setInterval> | null = null;

const currentActivity = computed<string>(() => {
  if (!props.isStreaming || props.messages.length === 0) return '处理中...';
  const last = props.messages[props.messages.length - 1];
  if (last.role !== 'assistant' || !last.blocks?.length) return '思考中...';
  const lastBlock = last.blocks[last.blocks.length - 1];
  if (lastBlock.type === 'tool' && 'tool' in lastBlock) {
    const toolName = lastBlock.tool.name;
    if (lastBlock.tool.status === 'calling') return `执行 ${toolName}...`;
    if (lastBlock.tool.status === 'approval-pending') return `等待审批 ${toolName}...`;
  }
  if (lastBlock.type === 'thinking') return '推理中...';
  if (lastBlock.type === 'delegate' && 'delegate' in lastBlock) {
    return `委派给 ${lastBlock.delegate.agentName || '子智能体'}...`;
  }
  return '生成中...';
});

const elapsedSeconds = computed(() => {
  if (!props.isStreaming || !processingStartedAt.value) return 0;
  return Math.max(0, Math.floor((nowTick.value - processingStartedAt.value) / 1000));
});

const elapsedLabel = computed(() => formatElapsed(elapsedSeconds.value));

const messageContainer = ref<HTMLElement | null>(null);

// ========== 智能滚动：用户往上浏览时不强制拉回底部 ==========
const userScrolledUp = ref(false);

function isNearBottom(): boolean {
  const el = messageContainer.value;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 60;
}

function handleScroll(): void {
  userScrolledUp.value = !isNearBottom();
}

function scrollToBottom(force = false): void {
  if (!force && userScrolledUp.value) return;

  const doScroll = (): void => {
    if (messageContainer.value) {
      messageContainer.value.scrollTop = messageContainer.value.scrollHeight;
      userScrolledUp.value = false;
    }
  };

  nextTick(() => {
    doScroll();
    // 如果是强制滚动（如加载历史），额外增加一个延迟以确保 Markdown/图片 等异步内容渲染完成
    if (force) {
      setTimeout(doScroll, 100);
      setTimeout(doScroll, 300);
    }
  });
}

function getProcessingStartTime(): number {
  const runningAssistant = [...props.messages]
    .reverse()
    .find((msg) => msg.role === 'assistant' && (msg.status === 'streaming' || (msg.stats && !msg.stats.endTime)));
  if (runningAssistant) {
    return runningAssistant.stats?.startTime || runningAssistant.timestamp;
  }

  const lastMessage = props.messages[props.messages.length - 1];
  return lastMessage?.timestamp || Date.now();
}

function startProcessingTimer(): void {
  if (!processingStartedAt.value) {
    processingStartedAt.value = getProcessingStartTime();
  }
  nowTick.value = Date.now();
  if (processingTimer) return;

  processingTimer = setInterval(() => {
    nowTick.value = Date.now();
  }, 1000);
}

function stopProcessingTimer(): void {
  if (processingTimer) {
    clearInterval(processingTimer);
    processingTimer = null;
  }
  processingStartedAt.value = null;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${String(restSeconds).padStart(2, '0')}s`;

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return `${hours}h ${String(restMinutes).padStart(2, '0')}m`;
}

defineExpose({
  scrollToBottom
});

// 监听消息数量变化（新消息到达）
watch(
  () => props.messages.length,
  (newLen, oldLen) => {
    // 如果是首次加载历史消息（从 0 到有），强制滚动到底部
    if (oldLen === 0 && newLen > 0) {
      scrollToBottom(true);
    } else {
      scrollToBottom();
    }
  }
);

watch(
  () => props.isStreaming,
  (streaming) => {
    if (streaming) {
      startProcessingTimer();
    } else {
      stopProcessingTimer();
    }
  },
  { immediate: true }
);

// 监听流式内容增量更新
watch(
  () => {
    const msgs = props.messages;
    if (msgs.length === 0) return 0;
    const last = msgs[msgs.length - 1];
    const blockCount = last.blocks?.length ?? 0;
    const lastBlock = blockCount > 0 && last.blocks ? last.blocks[blockCount - 1] : null;
    const lastLen = lastBlock ? ('text' in lastBlock ? lastBlock.text.length : 0) : 0;
    return last.content.length + blockCount * 1000 + lastLen;
  },
  () => scrollToBottom()
);

onMounted(() => {
  scrollToBottom(true);
});

onBeforeUnmount(() => {
  stopProcessingTimer();
});
</script>

<template>
  <div class="messages-wrapper">
    <div ref="messageContainer" class="panel-messages selectable" @scroll="handleScroll">
      <!-- 空状态 -->
      <div v-if="messages.length === 0" class="panel-empty">
        <slot name="empty">
          <div class="panel-empty-icon">
            <span class="i-mdi-star-four-points inline-block h-5 w-5" />
          </div>
          <p class="panel-empty-title">有什么可以帮您？</p>
          <p class="panel-empty-sub">输入消息开始对话</p>
        </slot>
      </div>

      <!-- 消息列表 -->
      <template v-for="msg in messages" :key="msg.id">
        <MessageItemUser v-if="msg.role === 'user'" :message="msg" />
        <MessageItemAssistant
          v-else
          :message="msg"
          :assistant-name="assistantName"
          @decide="(approval, decision) => emit('decide', approval, decision)" />
      </template>

      <div v-if="isStreaming" class="stream-indicator" aria-live="polite">
        <span class="stream-wave" aria-hidden="true">
          <span class="stream-wave-bar"></span>
          <span class="stream-wave-bar"></span>
          <span class="stream-wave-bar"></span>
        </span>
        <span class="stream-activity">{{ currentActivity }}</span>
        <span class="stream-elapsed">已处理 {{ elapsedLabel }}</span>
      </div>
    </div>

    <!-- 消息导航条 -->
    <MessageNavigator v-if="messages.length > 0" :messages="messages" :container-ref="messageContainer" />
  </div>
</template>

<style scoped>
/* ====== 消息容器 ====== */
.messages-wrapper {
  position: relative;
  flex: 1;
  display: flex;
  min-height: 0;
}

/* ====== 消息区域样式 ====== */
.panel-messages {
  flex: 1;
  overflow-y: auto;
  padding: 10px 0;
  padding-right: 16px;
  display: flex;
  flex-direction: column;
}

/* 空状态 */
.panel-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 24px;
  opacity: 0.8;
}

.panel-empty-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
  margin-bottom: 14px;
}

.panel-empty-title {
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin-bottom: 4px;
}

.panel-empty-sub {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  text-align: center;
  line-height: 1.5;
  margin-bottom: 16px;
}

.stream-indicator {
  padding: 5px 12px 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: hsl(var(--muted-foreground) / 0.5);
}

.stream-wave {
  display: inline-flex;
  height: 14px;
  width: 14px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

.stream-wave-bar {
  width: 2.5px;
  border-radius: 999px;
  background: hsl(var(--primary));
  animation: stream-wave-bounce 1.05s ease-in-out infinite;
}

.stream-wave-bar:nth-child(1) {
  height: 7px;
  animation-delay: -0.22s;
}

.stream-wave-bar:nth-child(2) {
  height: 12px;
  animation-delay: -0.11s;
}

.stream-wave-bar:nth-child(3) {
  height: 9px;
}

.stream-activity {
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--muted-foreground) / 0.82);
}

.stream-elapsed {
  display: inline-flex;
  align-items: center;
  height: 20px;
  border-radius: 999px;
  border: 1px solid hsl(var(--border) / 0.5);
  background: hsl(var(--muted) / 0.12);
  padding: 0 7px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  line-height: 18px;
  color: hsl(var(--foreground) / 0.68);
}

@keyframes stream-wave-bounce {
  0%,
  100% {
    transform: scaleY(0.35);
    opacity: 0.55;
  }

  50% {
    transform: scaleY(1);
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .stream-wave-bar {
    animation: none;
  }
}
</style>
