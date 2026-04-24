<script setup lang="ts">
import type { ChatMessage } from '../ChatMessages.vue';

defineProps<{
  message: ChatMessage;
}>();
</script>

<template>
  <div class="msg-block">
    <div class="msg-role-row">
      <span class="msg-role-icon msg-role-user">
        <span class="inline-block h-3 w-3 i-carbon-user" />
      </span>
      <span class="msg-role-name">你</span>
    </div>

    <div class="msg-content">
      <div class="msg-text">{{ message.content }}</div>
    </div>
  </div>
</template>

<style scoped>
/* 消息块 */
.msg-block {
  padding: 5px 12px;
}

.msg-role-row {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 3px;
}

.msg-role-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 4px;
}

.msg-role-user {
  background: hsl(var(--primary) / 0.15);
  color: hsl(var(--primary));
}

.msg-role-name {
  font-size: 12.5px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.msg-content {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.msg-text {
  font-size: 13.5px;
  line-height: 1.55;
  color: hsl(var(--foreground));
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
