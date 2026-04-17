<script setup lang="ts">
/**
 * ContextPanel — 上下文面板
 *
 * 显示当前任务的上下文信息（文件、工具等）
 */

import { ref } from 'vue';

defineProps<{
  threadId: string;
}>();

const contextFiles = ref<Array<{ name: string; path: string }>>([]);
</script>

<template>
  <div class="context-panel">
    <div class="context-header">
      <span class="context-title">任务上下文</span>
    </div>

    <div class="context-content">
      <div v-if="contextFiles.length === 0" class="context-empty">
        <span class="i-carbon-document inline-block h-5 w-5 opacity-20" />
        <span class="text-xs text-gray-400">暂无上下文文件</span>
      </div>

      <div v-else class="context-list">
        <div v-for="file in contextFiles" :key="file.path" class="context-item">
          <span class="i-carbon-document inline-block h-3 w-3" />
          <span class="context-item-name">{{ file.name }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.context-panel {
  display: flex;
  flex-direction: column;
  height: 160px;
  flex-shrink: 0;
  background: hsl(var(--surface) / 0.5);
  border-bottom: 1px solid hsl(var(--border) / 0.4);
}

.context-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  padding: 0 16px;
  border-bottom: 1px solid hsl(var(--border) / 0.3);
  background: hsl(var(--surface) / 0.7);
}

.context-title {
  font-size: 11px;
  font-weight: 600;
  color: hsl(var(--muted-foreground));
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.context-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.context-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  color: hsl(var(--muted-foreground) / 0.4);
}

.context-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.context-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  background: hsl(var(--background));
  border: 1px solid hsl(var(--border) / 0.3);
  color: hsl(var(--foreground) / 0.7);
  font-size: 12px;
  transition: all 0.15s ease;
  cursor: pointer;
}

.context-item:hover {
  background: hsl(var(--muted) / 0.1);
  border-color: hsl(var(--border) / 0.5);
}

.context-item-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-content::-webkit-scrollbar {
  width: 4px;
}

.context-content::-webkit-scrollbar-thumb {
  background: hsl(var(--foreground) / 0.1);
  border-radius: 2px;
}

.context-content::-webkit-scrollbar-thumb:hover {
  background: hsl(var(--foreground) / 0.2);
}
</style>
