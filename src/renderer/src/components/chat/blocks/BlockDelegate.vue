<script setup lang="ts">
import type { ContentBlock } from '@/types/chat';

defineProps<{
  block: ContentBlock & { type: 'delegate' };
}>();
</script>

<template>
  <div class="msg-delegate">
    <span class="i-carbon-bot inline-block h-3 w-3 shrink-0" />
    <span>{{ block.delegate.agentName || block.delegate.agentId }}</span>
    <span class="msg-delegate-status">
      {{ block.delegate.status === 'running' ? '委托中...' : '完成' }}
    </span>
  </div>
</template>

<style scoped>
.msg-delegate {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.08);
  padding: 3px 7px;
  border-radius: 5px;
  align-self: flex-start;
}

.msg-delegate-status {
  opacity: 0.7;
  font-size: 9.5px;
}
</style>
