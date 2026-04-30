<script setup lang="ts">
import { ref, computed } from 'vue';
import type { ContentBlock } from '@/types/chat';

const props = defineProps<{
  block: ContentBlock & { type: 'thinking' };
}>();

const collapsed = ref(true); // 默认折叠

const previewText = computed(() => {
  const text = props.block.text?.replace(/\s+/g, ' ').trim();
  if (!text) return '正在整理思路...';
  return text.length > 96 ? `${text.slice(0, 96)}...` : text;
});

function toggleCollapse(): void {
  collapsed.value = !collapsed.value;
}
</script>

<template>
  <div class="msg-thinking">
    <div class="thinking-row" @click="toggleCollapse">
      <span class="thinking-label">思考</span>
      <span v-if="collapsed" class="thinking-preview">{{ previewText }}</span>
      <span v-else class="thinking-spacer" />
      <button type="button" class="collapse-btn">
        <span
          class="inline-block h-3 w-3 transition-transform duration-200"
          :class="collapsed ? 'i-carbon-chevron-right' : 'i-carbon-chevron-down'" />
      </button>
    </div>
    <div v-show="!collapsed" class="thinking-body">
      <div class="msg-thinking-text">
        {{ block.text }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.msg-thinking {
  font-size: 12.5px;
  color: hsl(var(--muted-foreground));
  background: transparent;
  border: none;
  border-radius: 0;
}

.thinking-row {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 26px;
  padding: 3px 0;
  cursor: pointer;
  user-select: none;
}

.thinking-row:hover {
  color: hsl(var(--foreground) / 0.72);
}

.thinking-label {
  font-weight: 500;
  font-size: 11.5px;
  line-height: 1.35;
  color: hsl(var(--muted-foreground) / 0.64);
}

.thinking-preview {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  color: hsl(var(--muted-foreground) / 0.72);
}

.thinking-spacer {
  flex: 1;
}

.collapse-btn {
  display: flex;
  align-items: center;
  padding: 0;
  background: none;
  border: none;
  color: hsl(var(--muted-foreground) / 0.5);
  cursor: pointer;
}

.thinking-body {
  margin: 4px -8px 0;
  padding: 7px 8px;
  border: 1px solid hsl(var(--border) / 0.42);
  border-radius: 7px;
  background: hsl(var(--muted) / 0.1);
}

.msg-thinking-text {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 12px;
  line-height: 1.45;
}
</style>
