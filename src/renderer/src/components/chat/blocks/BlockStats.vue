<script setup lang="ts">
import { computed } from 'vue';
import type { ExecutionStats } from '@/types/chat';

const props = defineProps<{
  stats: ExecutionStats;
  messageContent: string;
}>();

function formatNumber(num: number): string {
  return num.toLocaleString('zh-CN');
}

function formatCompactNumber(num: number): string {
  if (num >= 10000) return `${(num / 10000).toFixed(1)}w`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return formatNumber(num);
}

const formattedDuration = computed(() => {
  if (!props.stats.duration) return '-';
  const seconds = (props.stats.duration / 1000).toFixed(1);
  return `${seconds}s`;
});

const formattedSpeed = computed(() => {
  if (!props.stats.tokensPerSecond) return '-';
  return `${formatNumber(props.stats.tokensPerSecond)} t/s`;
});

const tokenSummary = computed(() => {
  return `${formatCompactNumber(props.stats.inputTokens)}→${formatCompactNumber(props.stats.outputTokens)} tokens`;
});

async function copyMessage(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.messageContent);
    // TODO: 可以添加一个简单的提示
  } catch (err) {
    console.error('复制失败:', err);
  }
}
</script>

<template>
  <div class="stats-bar">
    <button class="stats-btn" title="复制消息" @click="copyMessage">
      <span class="i-carbon-copy" />
      <span>复制</span>
    </button>

    <span class="stats-chip">{{ formattedDuration }}</span>
    <span class="stats-chip stats-chip--primary">{{ tokenSummary }}</span>
    <span class="stats-chip">{{ formattedSpeed }}</span>
    <span class="stats-chip">模型 {{ stats.llmCalls }} · 工具 {{ stats.toolCalls }}</span>
  </div>
</template>

<style scoped>
.stats-bar {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 4px;
  margin-top: 3px;
  overflow: hidden;
}

.stats-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 20px;
  padding: 0 6px;
  border: 1px solid hsl(var(--border) / 0.55);
  background: hsl(var(--background) / 0.65);
  color: hsl(var(--muted-foreground) / 0.78);
  cursor: pointer;
  border-radius: 6px;
  font-size: 10.5px;
  line-height: 18px;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
  flex-shrink: 0;
}

.stats-btn span {
  display: inline-block;
}

.stats-btn span:first-child {
  width: 12px;
  height: 12px;
}

.stats-btn:hover {
  border-color: hsl(var(--primary) / 0.28);
  background: hsl(var(--primary) / 0.06);
  color: hsl(var(--foreground));
}

.stats-chip {
  display: inline-flex;
  align-items: center;
  height: 20px;
  border-radius: 6px;
  border: 1px solid hsl(var(--border) / 0.38);
  background: hsl(var(--muted) / 0.12);
  padding: 0 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10.5px;
  line-height: 18px;
  color: hsl(var(--muted-foreground) / 0.72);
  white-space: nowrap;
  flex-shrink: 0;
}

.stats-chip--primary {
  color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.06);
  border-color: hsl(var(--primary) / 0.16);
}

.stats-chip:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
