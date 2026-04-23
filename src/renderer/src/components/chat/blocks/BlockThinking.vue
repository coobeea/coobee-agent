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
      <span class="i-carbon-idea inline-block h-3 w-3 shrink-0" />
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
  background: hsl(var(--muted) / 0.16);
  border: 1px solid hsl(var(--border) / 0.45);
  border-radius: 6px;
  overflow: hidden;
}

.thinking-row {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 26px;
  padding: 3px 8px;
  cursor: pointer;
  user-select: none;
}

.thinking-row:hover {
  background: hsl(var(--muted) / 0.28);
}

.thinking-label {
  font-weight: 500;
  font-size: 11px;
  color: hsl(var(--foreground) / 0.68);
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
  color: hsl(var(--muted-foreground) / 0.6);
  cursor: pointer;
}

.thinking-body {
  border-top: 1px solid hsl(var(--border) / 0.35);
  padding: 6px 8px;
  background: hsl(var(--background) / 0.55);
}

.msg-thinking-text {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 12px;
  line-height: 1.45;
}
</style>
