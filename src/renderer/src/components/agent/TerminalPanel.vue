<script setup lang="ts">
/**
 * TerminalPanel — 终端面板
 *
 * 显示 Agent 执行命令的输出结果
 */

import { inject, computed, type Ref } from 'vue';

defineProps<{
  threadId: string;
}>();

// 从 ChatPanel 注入的 exec 输出
const execOutputs = inject<Ref<Array<{ id: string; command: string; output: string; exitCode?: number }>>>(
  'execOutputs',
  computed(() => [])
);
</script>

<template>
  <div class="terminal-panel">
    <div v-if="execOutputs.length === 0" class="terminal-empty">
      <span class="i-carbon-terminal inline-block h-5 w-5 opacity-20" />
      <span class="text-xs text-gray-400">暂无执行输出</span>
    </div>

    <div v-else class="terminal-content">
      <div v-for="exec in execOutputs" :key="exec.id" class="terminal-item">
        <div class="terminal-command">
          <span class="i-carbon-chevron-right inline-block h-3 w-3" />
          <span>{{ exec.command }}</span>
        </div>
        <pre class="terminal-output">{{ exec.output }}</pre>
        <div v-if="exec.exitCode !== undefined" class="terminal-exit">
          <span>退出码: {{ exec.exitCode }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.terminal-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: hsl(var(--background));
  border-top: 1px solid hsl(var(--border) / 0.3);
}

.terminal-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex: 1;
  color: hsl(var(--muted-foreground) / 0.4);
}

.terminal-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
  font-size: 12px;
}

.terminal-item {
  margin-bottom: 16px;
  border-radius: 6px;
  border: 1px solid hsl(var(--border) / 0.3);
  background: hsl(var(--muted) / 0.1);
  overflow: hidden;
}

.terminal-command {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: hsl(var(--muted) / 0.2);
  color: hsl(var(--foreground) / 0.8);
  font-weight: 500;
  border-bottom: 1px solid hsl(var(--border) / 0.2);
}

.terminal-output {
  padding: 12px;
  margin: 0;
  color: hsl(var(--foreground) / 0.7);
  white-space: pre-wrap;
  word-break: break-all;
}

.terminal-exit {
  padding: 6px 12px;
  background: hsl(var(--muted) / 0.15);
  color: hsl(var(--muted-foreground) / 0.6);
  font-size: 11px;
  border-top: 1px solid hsl(var(--border) / 0.2);
}

.terminal-content::-webkit-scrollbar {
  width: 6px;
}

.terminal-content::-webkit-scrollbar-thumb {
  background: hsl(var(--foreground) / 0.1);
  border-radius: 3px;
}

.terminal-content::-webkit-scrollbar-thumb:hover {
  background: hsl(var(--foreground) / 0.2);
}
</style>
