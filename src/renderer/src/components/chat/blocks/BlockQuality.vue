<script setup lang="ts">
import type { ContentBlock } from '@/types/chat';

defineProps<{
  block: ContentBlock & { type: 'quality' };
}>();
</script>

<template>
  <div class="msg-quality">
    <span class="i-carbon-checkmark-outline inline-block h-3 w-3 shrink-0" />
    <span class="msg-quality-text">{{ block.status }}</span>
  </div>
</template>

<style scoped>
.msg-quality {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  color: hsl(var(--chart-4, 270 60% 50%));
  background: hsl(var(--chart-4, 270 60% 50%) / 0.08);
  padding: 3px 7px;
  border-radius: 5px;
  align-self: flex-start;
}

.msg-quality-text {
  white-space: pre-wrap;
}
</style>
