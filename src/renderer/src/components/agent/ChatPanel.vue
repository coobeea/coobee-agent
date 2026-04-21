<script setup lang="ts">
/**
 * ChatPanel — 对话面板（全局 store 版）
 *
 * 消息由全局 chatStore 管理，组件只负责展示和交互。
 * 不需要手动订阅/退订，流式消息自动更新。
 */

import { ref, computed, watch, onMounted, nextTick } from 'vue';
import { useChatStore } from '@/stores/chat';
import { useThreadsStore } from '@/stores/threads';
import { useAgentsStore } from '@/stores/agents';
import type { StreamMessage } from '@shared/stream-protocol';
import { useGateway } from '@/composables/useGateway';
import { getThreadHistory } from '@/api/threads';
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
const threadsStore = useThreadsStore();
const agentsStore = useAgentsStore();
const { request } = useGateway();

// ==================== Refs ====================
const chatMessagesRef = ref<InstanceType<typeof ChatMessages> | null>(null);
const chatComposerRef = ref<InstanceType<typeof ChatComposer> | null>(null);

const agentGreeting = ref<string>('');
const agentStarterPrompts = ref<string[]>([]);

// ==================== Computed ====================
// 直接从 store 读取消息（自动响应式）
const messages = computed(() => chatStore.getThreadMessages(props.threadId));
const isStreaming = computed(() => {
  const thread = threadsStore.threads.find((t) => t.id === props.threadId);
  return thread?.runStatus === 'running' || thread?.runStatus === 'tool-pending';
});

// 获取当前 thread 和 agent 信息
const currentThread = computed(() => threadsStore.threads.find((t) => t.id === props.threadId));
const currentAgent = computed(() => {
  const thread = currentThread.value;
  if (!thread) return null;
  return agentsStore.agents.find((a) => a.id === thread.agentId);
});

// 从 agent metadata 中获取开场白和快捷问题
const greeting = computed(() => agentGreeting.value);
const starterPrompts = computed(() => agentStarterPrompts.value);

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

// 点击快捷问题时发送
function handleStarterPromptClick(prompt: string): void {
  if (!prompt || isStreaming.value) return;
  handleSend({ text: prompt });
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

async function loadAgentDetails(): Promise<void> {
  const thread = currentThread.value;
  if (!thread || !thread.agentId) return;

  try {
    const agentDetail = await agentsStore.getAgentDetail(thread.agentId);
    if (agentDetail && agentDetail.metadata) {
      agentGreeting.value = (agentDetail.metadata.greeting as string) || '';
      agentStarterPrompts.value = Array.isArray(agentDetail.metadata.starterPrompts)
        ? agentDetail.metadata.starterPrompts
        : [];
    } else {
      agentGreeting.value = '';
      agentStarterPrompts.value = [];
    }
  } catch (err) {
    console.error('[ChatPanel] loadAgentDetails error:', err);
  }
}

async function loadThreadHistory(): Promise<void> {
  // 如果 store 里已经有消息，说明是实时接收的，不需要再加载历史
  if (messages.value.length > 0) {
    return;
  }

  try {
    const result = await getThreadHistory(props.threadId);

    if (!result.success || !result.data) {
      console.warn('[ChatPanel] 历史加载失败:', result.error);
      return;
    }

    const history = result.data;

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
  await loadAgentDetails();
  await loadThreadHistory();
});

// 监听 threadId 变化（切换会话时重新加载）
watch(
  () => props.threadId,
  async (newThreadId, oldThreadId) => {
    if (newThreadId !== oldThreadId) {
      await loadAgentDetails();
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
    <ChatMessages ref="chatMessagesRef" :messages="messages" :is-streaming="isStreaming">
      <template v-if="greeting || starterPrompts.length > 0" #empty>
        <div class="flex flex-col items-center justify-center w-full max-w-2xl mx-auto px-6 py-12">
          <!-- 图标 -->
          <div class="flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 text-primary mb-6">
            <span class="i-mdi-star-four-points inline-block h-7 w-7" />
          </div>

          <!-- 开场白 -->
          <div v-if="greeting" class="text-center mb-8">
            <p class="text-base text-foreground leading-relaxed">{{ greeting }}</p>
          </div>

          <!-- 快捷问题 -->
          <div v-if="starterPrompts.length > 0" class="w-full flex flex-col gap-3">
            <p class="text-xs text-muted-foreground text-center mb-2">试试这些问题</p>
            <div class="grid grid-cols-1 gap-2">
              <button
                v-for="(prompt, index) in starterPrompts"
                :key="index"
                type="button"
                class="group flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-card hover:bg-accent hover:border-primary/40 transition-all text-left cursor-pointer"
                :disabled="isStreaming"
                @click="handleStarterPromptClick(prompt)">
                <span
                  class="i-carbon-chevron-right text-muted-foreground/60 group-hover:text-primary transition-colors shrink-0 text-base"></span>
                <span class="text-sm text-foreground/85 group-hover:text-foreground transition-colors">{{
                  prompt
                }}</span>
              </button>
            </div>
          </div>
        </div>
      </template>
    </ChatMessages>

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
