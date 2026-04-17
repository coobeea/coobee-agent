<script setup lang="ts">
/**
 * AgentChatPanel — 智能体对话面板（集成完整消息系统）
 *
 * 功能：
 *   1. 集成 useStreamHandler 处理消息渲染
 *   2. 集成 useStreamWs 订阅流式消息
 *   3. 使用 ChatMessages 组件展示消息
 *   4. 支持发送消息到 Gateway RPC
 */

import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useStreamHandler } from '@/composables/useStreamHandler';
import { streamSubscribe, streamUnsubscribe } from '@/composables/useStreamWs';
import { useGateway } from '@/composables/useGateway';
import { gateway } from '@/plugins/gatewaySetup';
import type { StreamMessage } from '@shared/stream-protocol';
import ChatMessages from '@/components/chat/ChatMessages.vue';
import { nanoid } from 'nanoid';

const props = defineProps<{
  agentId: string;
}>();

const isCollapsed = defineModel<boolean>('collapsed', { default: false });

const agentsStore = useAgentsStore();
const chatStore = useChatStore();
const { request } = useGateway();

/** 当前智能体 */
const currentAgent = computed(() => {
  return agentsStore.agents.find((a) => a.id === props.agentId);
});

/** Thread ID（动态创建） */
const threadId = ref<string | null>(null);

/** 是否正在初始化 */
const isInitializing = ref(false);

/** 输入框内容 */
const chatInput = ref('');

/** 流状态 */
const streamState = computed(() => (threadId.value ? chatStore.getState(threadId.value) : { isStreaming: false, currentSequence: 0 }));

/** 使用 useStreamHandler 管理消息 */
const { messages, isStreaming, handleStreamMessage, addUserMessage, resetAll } = useStreamHandler({
  idPrefix: 'chat',
  maxMessages: 500
});

/** 当前订阅的 sessionId */
let subscribedSessionId: string | null = null;

/**
 * 处理流式消息并同步 Store 状态
 */
function handleStreamMessageWithSync(msg: StreamMessage): void {
  // 更新本地消息
  handleStreamMessage(msg);

  // 同步 Store 的 isStreaming 状态
  if (msg.type === 'run:start') {
    chatStore.setState(threadId.value, true, msg.sequence);
  } else if (msg.type === 'run:done' || msg.type === 'run:error') {
    chatStore.setState(threadId.value, false, msg.sequence);
  }
}

/**
 * 初始化 Thread（创建或复用）
 */
async function initializeThread(): Promise<void> {
  if (isInitializing.value || threadId.value) return;

  isInitializing.value = true;

  try {
    // 调用 Gateway RPC 创建新 Thread
    const result = (await request('chat.createThread', {
      agentId: props.agentId,
      title: `${currentAgent.value?.name || 'Agent'} 工作区对话`
    })) as { id: string };

    threadId.value = result.id;
    console.log(`[AgentChatPanel] Thread 已创建: ${threadId.value}`);
  } catch (error) {
    console.error('[AgentChatPanel] Thread 创建失败:', error);
  } finally {
    isInitializing.value = false;
  }
}

/**
 * 加载历史消息
 */
async function loadHistory(): Promise<void> {
  if (!threadId.value) return;

  try {
    const baseUrl = import.meta.env.VITE_GATEWAY_BASE_URL || 'http://127.0.0.1:8765/gateway';
    const res = await fetch(`${baseUrl}/threads/${threadId.value}/history`);

    if (!res.ok) {
      console.warn('[AgentChatPanel] 历史消息加载失败:', res.statusText);
      return;
    }

    const data = (await res.json()) as {
      events: { ts: string; seq: number; type: string; content: string; data?: Record<string, unknown> }[];
      userMessages: { content: string; timestamp: number }[];
    };

    // 按序号处理历史事件
    let userIdx = 0;

    for (const evt of data.events) {
      // 转换为 StreamMessage 格式
      const streamMsg: StreamMessage = {
        id: `hist-${evt.seq}`,
        sessionId: threadId.value,
        sequence: evt.seq,
        timestamp: new Date(evt.ts).getTime(),
        type: evt.type as string,
        content: evt.content,
        data: evt.data,
        source: { type: 'agent', id: currentAgent.value?.id || '', name: currentAgent.value?.name || '' }
      };

      // 在 run:start 之前插入对应的用户消息
      if (evt.type === 'run:start' && userIdx < data.userMessages.length) {
        addUserMessage(data.userMessages[userIdx].content);
        userIdx++;
      }

      // 处理历史事件
      handleStreamMessage(streamMsg);
    }

    console.log(`[AgentChatPanel] 已加载 ${data.events.length} 条历史事件, ${data.userMessages.length} 条用户消息`);
  } catch (error) {
    console.error('[AgentChatPanel] 历史消息加载错误:', error);
  }
}

/**
 * 订阅流式消息
 */
function ensureSubscription(): void {
  if (!threadId.value) return;

  if (subscribedSessionId !== threadId.value) {
    if (subscribedSessionId) {
      streamUnsubscribe(subscribedSessionId, handleStreamMessageWithSync);
    }
    streamSubscribe(threadId.value, handleStreamMessageWithSync);
    subscribedSessionId = threadId.value;
  }
}

/**
 * 取消订阅
 */
function unsubscribe(): void {
  if (subscribedSessionId) {
    streamUnsubscribe(subscribedSessionId, handleStreamMessageWithSync);
    subscribedSessionId = null;
  }
}

/**
 * 发送消息
 */
async function sendMessage(): Promise<void> {
  if (!chatInput.value.trim() || streamState.value.isStreaming || !threadId.value) return;

  const userMessage = chatInput.value.trim();
  chatInput.value = '';

  try {
    // 添加用户消息到 UI
    addUserMessage(userMessage);

    // 调用 Gateway RPC 发送消息
    // 后端参数：threadId (必需), message (必需)
    await request('chat.sendMessage', {
      threadId: threadId.value,
      message: userMessage
    });
  } catch (error) {
    console.error('[AgentChatPanel] sendMessage error:', error);
    
    // 显示错误提示
    handleStreamMessage({
      id: `error-${nanoid(8)}`,
      sessionId: threadId.value,
      sequence: 0,
      type: 'run:error',
      content: error instanceof Error ? error.message : '发送失败',
      timestamp: Date.now(),
      source: { type: 'agent', id: props.agentId, name: '' }
    });
  }
}

/**
 * 清空对话
 */
function clearMessages(): void {
  resetAll();
  chatStore.resetState(threadId.value);
}

/**
 * 处理回车发送
 */
function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    sendMessage();
  }
}

/**
 * 初始化整个聊天流程（等待连接 + 创建 Thread + 加载历史 + 订阅）
 */
async function initializeChatFlow(): Promise<void> {
  console.log('[AgentChatPanel] 开始初始化聊天流程...');
  
  // 1. 等待 WebSocket 连接成功
  if (gateway.connectionState.value !== 'connected') {
    console.log('[AgentChatPanel] 等待 WebSocket 连接...当前状态:', gateway.connectionState.value);
    
    await new Promise<void>((resolve) => {
      if (gateway.connectionState.value === 'connected') {
        console.log('[AgentChatPanel] WebSocket 已连接');
        resolve();
        return;
      }
      
      const checkConnection = (): void => {
        console.log('[AgentChatPanel] WebSocket 状态变化:', gateway.connectionState.value);
        if (gateway.connectionState.value === 'connected') {
          console.log('[AgentChatPanel] WebSocket 连接成功！');
          cleanup();
          resolve();
        }
      };
      
      const unwatch = watch(() => gateway.connectionState.value, checkConnection);
      const timeout = setTimeout(() => {
        cleanup();
        console.warn('[AgentChatPanel] WebSocket 连接超时，继续初始化');
        resolve();
      }, 10000);
      
      function cleanup(): void {
        unwatch();
        clearTimeout(timeout);
      }
    });
  } else {
    console.log('[AgentChatPanel] WebSocket 已连接');
  }
  
  // 2. 创建 Thread
  console.log('[AgentChatPanel] 开始创建 Thread...');
  await initializeThread();
  
  // 3. 加载历史消息
  console.log('[AgentChatPanel] 开始加载历史消息...');
  await loadHistory();
  
  // 4. 订阅流式消息
  console.log('[AgentChatPanel] 开始订阅流式消息...');
  ensureSubscription();
  
  console.log('[AgentChatPanel] 聊天流程初始化完成！');
}

// 监听 agentId 变化，重新初始化
watch(
  () => props.agentId,
  async () => {
    resetAll();
    threadId.value = null;
    await initializeChatFlow();
  }
);

// 组件挂载时初始化
onMounted(async () => {
  await initializeChatFlow();
});

// 组件卸载时取消订阅
onUnmounted(() => {
  unsubscribe();
});
</script>

<template>
  <aside
    v-show="!isCollapsed"
    class="chat-panel">
    <!-- 智能体信息栏 -->
    <div class="agent-info">
      <div class="agent-info-header">
        <div class="agent-avatar-large">
          <span class="i-carbon-bot inline-block h-5 w-5" />
        </div>
        <div class="agent-details">
          <h3 class="agent-name">{{ currentAgent?.name }}</h3>
          <p
            v-if="currentAgent?.model"
            class="agent-model">
            <span class="i-carbon-machine-learning-model inline-block h-3 w-3" />
            <span>{{ currentAgent.model }}</span>
          </p>
        </div>
        <button
          class="collapse-btn"
          title="折叠面板"
          @click="isCollapsed = true">
          <span class="i-carbon-chevron-right inline-block h-3 w-3"></span>
        </button>
      </div>
    </div>

    <!-- 对话容器 -->
    <div class="chat-container">
      <div class="chat-header">
        <span class="chat-title">对话</span>
        <button
          v-if="messages.length > 0"
          class="clear-btn"
          title="清空对话"
          @click="clearMessages">
          <span class="i-carbon-trash-can inline-block h-3 w-3" />
        </button>
      </div>

      <!-- 消息列表（使用 ChatMessages 组件） -->
      <ChatMessages
        :messages="messages"
        :is-streaming="isStreaming" />

      <!-- 输入区 -->
      <div class="chat-input-container">
        <textarea
          v-model="chatInput"
          class="chat-input"
          :placeholder="isInitializing ? '初始化中...' : '输入消息...'"
          :disabled="streamState.isStreaming || isInitializing || !threadId"
          @keydown="handleKeydown" />
        <button
          class="send-btn"
          :disabled="!chatInput.trim() || streamState.isStreaming || isInitializing || !threadId"
          @click="sendMessage">
          <span class="i-carbon-send-alt inline-block h-4 w-4" />
        </button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.chat-panel {
  display: flex;
  flex-direction: column;
  width: 400px;
  flex-shrink: 0;
  background: hsl(var(--surface) / 0.5);
  border-left: 1px solid hsl(var(--border) / 0.4);
}

/* 智能体信息栏 */
.agent-info {
  flex-shrink: 0;
  border-bottom: 1px solid hsl(var(--border) / 0.3);
  background: hsl(var(--surface) / 0.6);
}

.agent-info-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
}

.agent-avatar-large {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: hsl(var(--primary) / 0.12);
  color: hsl(var(--primary) / 0.7);
  flex-shrink: 0;
}

.agent-details {
  flex: 1;
  min-width: 0;
}

.agent-name {
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agent-model {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: hsl(var(--muted-foreground) / 0.7);
}

.collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: hsl(var(--muted-foreground) / 0.5);
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.collapse-btn:hover {
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--foreground) / 0.7);
}

/* 对话容器 */
.chat-container {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 16px;
  flex-shrink: 0;
  border-bottom: 1px solid hsl(var(--border) / 0.2);
}

.chat-title {
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--foreground) / 0.9);
}

.clear-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: hsl(var(--muted-foreground) / 0.5);
  transition: all 0.15s ease;
}

.clear-btn:hover {
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--error));
}

/* 输入区 */
.chat-input-container {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  flex-shrink: 0;
  border-top: 1px solid hsl(var(--border) / 0.2);
  background: hsl(var(--surface) / 0.6);
}

.chat-input {
  flex: 1;
  min-height: 36px;
  max-height: 120px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid hsl(var(--border) / 0.4);
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font-size: 13px;
  line-height: 1.5;
  resize: none;
  transition: all 0.15s ease;
}

.chat-input:focus {
  border-color: hsl(var(--primary));
  outline: none;
  box-shadow: 0 0 0 1px hsl(var(--primary) / 0.2);
}

.chat-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.send-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.send-btn:hover:not(:disabled) {
  background: hsl(var(--primary-hover));
  box-shadow: 0 2px 8px hsl(var(--primary) / 0.3);
}

.send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
