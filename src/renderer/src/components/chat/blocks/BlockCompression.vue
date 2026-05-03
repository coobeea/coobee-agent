<script setup lang="ts">
import { computed } from 'vue';
import type { ContentBlock } from '@/types/chat';

const props = defineProps<{
  block: ContentBlock & { type: 'compression' };
}>();

const iconClass = computed(() => {
  const status = props.block.compression.status;
  if (status === 'compressing') return 'i-carbon-data-enrichment animate-spin';
  if (status === 'done') return 'i-carbon-checkmark';
  return 'i-carbon-warning-alt';
});
</script>

<template>
  <div class="compression-block">
    <span class="compression-icon" :class="iconClass" />
    <span class="compression-text">
      <template v-if="block.compression.status === 'compressing'">
        正在压缩上下文...
      </template>
      <template v-else-if="block.compression.status === 'done'">
        上下文压缩完成
      </template>
      <template v-else-if="block.compression.status === 'error'">
        上下文压缩失败{{ block.compression.error ? `：${block.compression.error}` : '' }}
      </template>
    </span>
  </div>
</template>

<style scoped>
.compression-block {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}

.compression-icon {
  display: inline-block;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.compression-text {
  line-height: 1.4;
}

.animate-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
