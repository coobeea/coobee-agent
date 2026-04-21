<script setup lang="ts">
import { computed } from 'vue';
import type { ExecutionStats } from '@/types/chat';

const props = defineProps<{
  stats: ExecutionStats;
  messageContent: string;
}>();

// 格式化数字（添加千位分隔符）
function formatNumber(num: number): string {
  return num.toLocaleString('zh-CN');
}

// 格式化时间（HH:mm:ss）
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { 
    hour: '2-digit', 
    minute: '2-digit',
    second: '2-digit'
  });
}

// 格式化耗时
const formattedDuration = computed(() => {
  if (!props.stats.duration) return '-';
  const seconds = (props.stats.duration / 1000).toFixed(1);
  return `${seconds}s`;
});

// 格式化速率
const formattedSpeed = computed(() => {
  if (!props.stats.tokensPerSecond) return '-';
  return `${formatNumber(props.stats.tokensPerSecond)} t/s`;
});

// 开始时间
const startTime = computed(() => formatTime(props.stats.startTime));

// 结束时间
const endTime = computed(() => {
  return props.stats.endTime ? formatTime(props.stats.endTime) : '-';
});

// 复制消息内容
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
    <!-- 左侧：操作按钮 -->
    <div class="stats-actions">
      <button class="stats-btn" title="复制消息" @click="copyMessage">
        <span class="i-carbon-copy" />
      </button>
    </div>

    <span class="stats-divider">·</span>

    <!-- 中间：统计信息组 -->
    <div class="stats-metrics">
      <!-- 时间范围 -->
      <div class="stats-metric">
        <span class="stats-text">{{ startTime }}</span>
        <span class="stats-text stats-text--muted">~</span>
        <span class="stats-text">{{ endTime }}</span>
      </div>

      <span class="stats-divider">·</span>

      <!-- 耗时 -->
      <div class="stats-metric">
        <span class="stats-text">{{ formattedDuration }}</span>
      </div>

      <span class="stats-divider">·</span>

      <!-- Token -->
      <div class="stats-metric">
        <span class="stats-text">{{ formatNumber(stats.inputTokens) }}</span>
        <span class="stats-text stats-text--muted">→</span>
        <span class="stats-text stats-text--primary">{{ formatNumber(stats.outputTokens) }}</span>
        <span class="stats-text stats-text--muted">tokens</span>
      </div>

      <span class="stats-divider">·</span>

      <!-- 速率 -->
      <div class="stats-metric">
        <span class="stats-text">{{ formattedSpeed }}</span>
      </div>

      <span class="stats-divider">·</span>

      <!-- 调用统计 -->
      <div class="stats-metric">
        <span class="stats-text">模型{{ stats.llmCalls }}</span>
        <span class="stats-text stats-text--muted">·</span>
        <span class="stats-text">工具{{ stats.toolCalls }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stats-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 2px 0;
  min-height: 24px;
}

.stats-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.stats-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  background: transparent;
  color: hsl(var(--muted-foreground) / 0.6);
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.15s;
  flex-shrink: 0;
}

.stats-btn span {
  width: 14px;
  height: 14px;
  display: block;
}

.stats-btn:hover {
  background: hsl(var(--muted) / 0.5);
  color: hsl(var(--foreground));
}

.stats-divider {
  color: hsl(var(--muted-foreground) / 0.3);
  font-size: 11px;
  line-height: 20px;
  flex-shrink: 0;
}

.stats-metrics {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.stats-metric {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.stats-text {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  line-height: 20px;
  color: hsl(var(--muted-foreground) / 0.8);
  white-space: nowrap;
}

.stats-text--muted {
  color: hsl(var(--muted-foreground) / 0.5);
}

.stats-text--primary {
  color: hsl(var(--primary));
  font-weight: 600;
}
</style>
