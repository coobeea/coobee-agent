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
import type { HistoryAssistantMessageV2, HistoryToolCallV2, StreamChatMessage } from '@/types/chat';
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
const agentDisplayName = ref<string>('');

// ==================== Computed ====================
// 直接从 store 读取消息（自动响应式）
const messages = computed(() => chatStore.getThreadMessages(props.threadId));
const isStreaming = computed(() => {
  const thread = threadsStore.threads.find((t) => t.id === props.threadId);
  return thread?.runStatus === 'running';
});

// 获取当前 thread 信息
const currentThread = computed(() => threadsStore.threads.find((t) => t.id === props.threadId));

// 从 agent metadata 中获取开场白和快捷问题
const greeting = computed(() => agentGreeting.value);
const starterPrompts = computed(() => agentStarterPrompts.value);
const assistantName = computed(() => {
  const thread = currentThread.value;
  const listName = agentsStore.agents.find((agent) => agent.id === thread?.agentId)?.name;
  return thread?.agentName || agentDisplayName.value || listName || '智能体';
});

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';

  return value
    .map((item) => {
      if (typeof item === 'string') return item;
      if (!isRecord(item)) return '';
      const type = typeof item.type === 'string' ? item.type : '';
      if (type && type !== 'text') return '';
      const text = item.text ?? item.content;
      return typeof text === 'string' ? text : '';
    })
    .join('');
}

function isHistoryAssistantMessageV2(value: unknown): value is HistoryAssistantMessageV2 {
  return (
    isRecord(value) &&
    value.version === 2 &&
    value.role === 'assistant' &&
    typeof value.id === 'string' &&
    typeof value.timestamp === 'string' &&
    typeof value.content === 'string' &&
    Array.isArray(value.turns) &&
    isRecord(value.usage)
  );
}

function formatToolArguments(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function collectHistoryToolCalls(msg: HistoryAssistantMessageV2): HistoryToolCallV2[] {
  return msg.turns.flatMap((turn) => (Array.isArray(turn.toolCalls) ? turn.toolCalls : []));
}

async function loadAgentDetails(): Promise<void> {
  const thread = currentThread.value;
  agentDisplayName.value = '';
  if (!thread || !thread.agentId) return;

  try {
    const agentDetail = await agentsStore.getAgentDetail(thread.agentId);
    if (agentDetail) {
      agentDisplayName.value = agentDetail.name || '';
      if (agentDetail.metadata) {
        agentGreeting.value = (agentDetail.metadata.greeting as string) || '';
        agentStarterPrompts.value = Array.isArray(agentDetail.metadata.starterPrompts)
          ? agentDetail.metadata.starterPrompts
          : [];
      } else {
        agentGreeting.value = '';
        agentStarterPrompts.value = [];
      }
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

    if (!history.messages || history.messages.length === 0) {
      return;
    }

    // 直接处理聚合好的消息（来自 history.jsonl）
    for (const msg of history.messages) {
      const msgData = msg as any; // 临时使用 any，因为聚合消息格式不同

      if (msgData.role === 'user') {
        // 用户消息
        const historyText = normalizeText(msgData.text || msgData.content);
        chatStore.addUserMessage(props.threadId, historyText);
      } else if (isHistoryAssistantMessageV2(msgData)) {
        // AI 消息（已聚合）
        const historyText = msgData.content;
        const startTime = new Date(msgData.startTime || msgData.timestamp).getTime();
        const endTime = msgData.endTime ? new Date(msgData.endTime).getTime() : undefined;
        const toolCalls = collectHistoryToolCalls(msgData);
        const chatMsg: StreamChatMessage = {
          id: msgData.id || `hist-${msgData.timestamp}`,
          role: 'assistant',
          content: historyText,
          blocks: [],
          status: msgData.status === 'running' ? 'done' : msgData.status,
          timestamp: new Date(msgData.timestamp).getTime()
        };

        // 按 turn 恢复 block，保留每轮 reasoning 的独立折叠块。
        for (const turn of msgData.turns) {
          if (turn.reasoning) {
            chatMsg.blocks.push({
              type: 'thinking',
              text: turn.reasoning
            });
          }

          for (const tool of turn.toolCalls || []) {
            chatMsg.blocks.push({
              type: 'tool',
              tool: {
                name: tool.name || 'unknown',
                arguments: formatToolArguments(tool.arguments),
                result: tool.result || '',
                status: tool.status === 'calling' ? 'done' : tool.status
              }
            });
          }

          if (turn.content) {
            chatMsg.blocks.push({
              type: 'text',
              text: turn.content
            });
          }
        }

        if (chatMsg.blocks.length === 0 && historyText) {
          chatMsg.blocks.push({
            type: 'text',
            text: historyText
          });
        }

        // 添加统计信息
        const duration = endTime ? endTime - startTime : undefined;
        chatMsg.stats = {
          inputTokens: msgData.usage.inputTokens || 0,
          outputTokens: msgData.usage.outputTokens || 0,
          totalTokens: msgData.usage.totalTokens || 0,
          contextWindow: msgData.usage.contextWindow,
          llmCalls: msgData.turns.filter((turn) => turn.usage.totalTokens > 0).length,
          toolCalls: toolCalls.length,
          startTime,
          endTime,
          duration,
          tokensPerSecond:
            duration && duration > 0 && msgData.usage.outputTokens > 0
              ? Math.round((msgData.usage.outputTokens / duration) * 1000)
              : undefined
        };

        if (msgData.error) {
          chatMsg.error = msgData.error;
        }

        // 添加到 chatStore
        chatStore.addHistoryMessage(props.threadId, chatMsg);
      }
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
    <ChatMessages
      ref="chatMessagesRef"
      :messages="messages"
      :is-streaming="isStreaming"
      :assistant-name="assistantName">
      <template v-if="greeting || starterPrompts.length > 0" #empty>
        <div class="mx-auto flex w-full max-w-xl flex-col items-center justify-center px-4 py-8">
          <!-- 图标 -->
          <div class="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <span class="i-mdi-star-four-points inline-block h-5 w-5" />
          </div>

          <!-- 开场白 -->
          <div v-if="greeting" class="mb-5 text-center">
            <p class="text-sm leading-6 text-foreground/90">{{ greeting }}</p>
          </div>

          <!-- 快捷问题 -->
          <div v-if="starterPrompts.length > 0" class="flex w-full flex-col gap-2">
            <p class="text-center text-[11px] text-muted-foreground/75">试试这些问题</p>
            <div class="grid grid-cols-1 gap-1.5">
              <button
                v-for="(prompt, index) in starterPrompts"
                :key="index"
                type="button"
                class="group flex cursor-pointer items-center gap-2 rounded-lg border border-border/60 bg-muted/10 px-3 py-2 text-left transition-colors hover:border-primary/30 hover:bg-primary/5"
                :disabled="isStreaming"
                @click="handleStarterPromptClick(prompt)">
                <span
                  class="i-carbon-chevron-right shrink-0 text-sm text-muted-foreground/55 transition-colors group-hover:text-primary"></span>
                <span class="text-[13px] leading-5 text-foreground/85 transition-colors group-hover:text-foreground">{{
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
  padding: 10px;
  background: hsl(var(--background));
  border-left: 1px solid hsl(var(--border) / 0.4);
}

.chat-panel--stacked {
  border-left: none;
  border-top: 1px solid hsl(var(--border) / 0.4);
}
</style>
