<script setup lang="ts">
/**
 * AgentChatPanel — 智能体对话测试面板（右侧）
 *
 * 包含：
 *   - 智能体信息（上）
 *   - 对话测试区（下）
 */

import { ref, computed } from 'vue';
import { useAgentsStore } from '@/stores/agents';

const props = defineProps<{
  agentId: string;
}>();

const isCollapsed = defineModel<boolean>('collapsed', { default: false });

const agentsStore = useAgentsStore();

// 获取当前智能体
const currentAgent = computed(() => {
  return agentsStore.agents.find(a => a.id === props.agentId);
});

// 对话输入
const chatInput = ref('');
const messages = ref<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
const isSending = ref(false);

// 发送消息
async function sendMessage(): Promise<void> {
  if (!chatInput.value.trim() || isSending.value) return;
  
  const userMessage = chatInput.value.trim();
  chatInput.value = '';
  
  // 添加用户消息
  messages.value.push({
    role: 'user',
    content: userMessage
  });
  
  isSending.value = true;
  
  // TODO: 这里需要调用实际的对话 API
  // 暂时模拟一个简单的响应
  setTimeout(() => {
    messages.value.push({
      role: 'assistant',
      content: '这是一个测试响应。实际的对话功能需要接入后端 API。'
    });
    isSending.value = false;
  }, 1000);
}

// 清空对话
function clearMessages(): void {
  messages.value = [];
}

// 处理回车发送
function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
}
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
          <p class="agent-model" v-if="currentAgent?.model">
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

    <!-- 对话测试区 -->
    <div class="chat-container">
      <div class="chat-header">
        <span class="chat-title">对话测试</span>
        <button
          v-if="messages.length > 0"
          class="clear-btn"
          title="清空对话"
          @click="clearMessages">
          <span class="i-carbon-trash-can inline-block h-3 w-3" />
        </button>
      </div>

      <!-- 消息列表 -->
      <div class="messages-container">
        <div v-if="messages.length === 0" class="messages-empty">
          <span class="i-carbon-chat inline-block h-8 w-8 opacity-10" />
          <p>开始与智能体对话测试</p>
        </div>
        
        <div
          v-for="(message, index) in messages"
          :key="index"
          class="message"
          :class="message.role">
          <div class="message-avatar">
            <span
              v-if="message.role === 'user'"
              class="i-carbon-user inline-block h-3.5 w-3.5" />
            <span
              v-else
              class="i-carbon-bot inline-block h-3.5 w-3.5" />
          </div>
          <div class="message-content">
            {{ message.content }}
          </div>
        </div>

        <!-- 加载中 -->
        <div v-if="isSending" class="message assistant loading">
          <div class="message-avatar">
            <span class="i-carbon-bot inline-block h-3.5 w-3.5" />
          </div>
          <div class="message-content">
            <span class="i-carbon-renew inline-block h-3 w-3 animate-spin" />
            <span>思考中...</span>
          </div>
        </div>
      </div>

      <!-- 输入区 -->
      <div class="chat-input-container">
        <textarea
          v-model="chatInput"
          class="chat-input"
          placeholder="输入消息测试智能体..."
          :disabled="isSending"
          @keydown="handleKeydown"
        />
        <button
          class="send-btn"
          :disabled="!chatInput.trim() || isSending"
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

/* 消息列表 */
.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.messages-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  flex: 1;
  color: hsl(var(--muted-foreground) / 0.4);
  font-size: 12px;
  text-align: center;
}

.message {
  display: flex;
  gap: 10px;
  animation: messageIn 0.2s ease;
}

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

.message-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  flex-shrink: 0;
}

.message.user .message-avatar {
  background: hsl(var(--muted) / 0.4);
  color: hsl(var(--foreground) / 0.6);
}

.message.assistant .message-avatar {
  background: hsl(var(--primary) / 0.12);
  color: hsl(var(--primary) / 0.7);
}

.message-content {
  flex: 1;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
}

.message.user .message-content {
  background: hsl(var(--primary) / 0.08);
  color: hsl(var(--foreground) / 0.95);
}

.message.assistant .message-content {
  background: hsl(var(--muted) / 0.3);
  color: hsl(var(--foreground) / 0.92);
}

.message.loading .message-content {
  display: flex;
  align-items: center;
  gap: 8px;
  color: hsl(var(--muted-foreground) / 0.5);
  font-size: 12px;
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

/* 滚动条 */
.messages-container::-webkit-scrollbar {
  width: 4px;
}

.messages-container::-webkit-scrollbar-thumb {
  background: hsl(var(--foreground) / 0.1);
  border-radius: 4px;
}

.messages-container::-webkit-scrollbar-thumb:hover {
  background: hsl(var(--foreground) / 0.2);
}
</style>
