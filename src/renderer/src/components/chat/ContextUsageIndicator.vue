<script setup lang="ts">
/**
 * ContextUsageIndicator — 输入框工具栏内的上下文使用量仪表。
 */
import { computed } from 'vue';
import type { ExecutionStats } from '@/types/chat';

const props = defineProps<{
  stats?: ExecutionStats;
}>();

const usedTokens = computed(() => props.stats?.contextInputTokens ?? props.stats?.inputTokens ?? 0);
const contextWindow = computed(() => props.stats?.contextWindow ?? 0);
const hasUsage = computed(() => contextWindow.value > 0 && usedTokens.value > 0);
const percent = computed(() => {
  if (contextWindow.value <= 0) return 0;
  return Math.min(100, Math.max(0, (usedTokens.value / contextWindow.value) * 100));
});

const activeBars = computed(() => {
  if (contextWindow.value <= 0 || usedTokens.value <= 0) return 0;
  return Math.max(1, Math.ceil(percent.value / 20));
});

const level = computed<'normal' | 'warning' | 'danger'>(() => {
  if (!hasUsage.value) return 'normal';
  if (percent.value >= 85) return 'danger';
  if (percent.value >= 70) return 'warning';
  return 'normal';
});

const percentLabel = computed(() => (hasUsage.value ? `${Math.round(percent.value)}%` : '--'));
const usedLabel = computed(() => (hasUsage.value ? formatCompactNumber(usedTokens.value) : '--'));
const windowLabel = computed(() => (contextWindow.value > 0 ? formatCompactNumber(contextWindow.value) : '--'));

const ariaLabel = computed(() => {
  if (!hasUsage.value) return '暂无上下文使用量，完成一次模型调用后显示';
  return `上下文 ${formatCompactNumber(usedTokens.value)} / ${formatCompactNumber(contextWindow.value)} · ${percentLabel.value}`;
});

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}
</script>

<template>
  <div class="context-usage" :class="[`context-usage--${level}`, { 'context-usage--empty': !hasUsage }]">
    <button type="button" class="context-usage-button" :aria-label="ariaLabel">
      <span class="context-usage-bars" aria-hidden="true">
        <span
          v-for="bar in 5"
          :key="bar"
          class="context-usage-bar"
          :class="{ 'context-usage-bar--active': bar <= activeBars }" />
      </span>
    </button>

    <div class="context-usage-popover" role="tooltip">
      <div class="context-usage-popover-head">
        <span class="context-usage-popover-title">上下文</span>
        <span class="context-usage-popover-percent">{{ percentLabel }}</span>
      </div>
      <div class="context-usage-popover-meter">
        <span class="context-usage-popover-fill" :style="{ width: `${percent}%` }" />
      </div>
      <div class="context-usage-popover-grid">
        <span>已用</span>
        <strong>{{ usedLabel }}</strong>
        <span>窗口</span>
        <strong>{{ windowLabel }}</strong>
      </div>
      <p v-if="!hasUsage" class="context-usage-popover-empty">完成一次模型调用后显示</p>
    </div>
  </div>
</template>

<style scoped>
.context-usage {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: hsl(var(--muted-foreground) / 0.9);
  user-select: none;
}

.context-usage-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 24px;
  border: 1px solid hsl(var(--border) / 0.3);
  border-radius: 6px;
  background: hsl(var(--background) / 0.72);
  color: inherit;
  cursor: help;
  outline: none;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}

.context-usage:hover .context-usage-button,
.context-usage-button:focus-visible {
  border-color: hsl(var(--border) / 0.5);
  background: hsl(var(--muted) / 0.45);
  color: hsl(var(--foreground));
}

.context-usage-bars {
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;
  height: 13px;
}

.context-usage-bar {
  width: 3px;
  border-radius: 999px;
  background: hsl(var(--muted-foreground) / 0.22);
  transition:
    height 0.18s ease,
    background-color 0.18s ease;
}

.context-usage-bar:nth-child(1) {
  height: 4px;
}

.context-usage-bar:nth-child(2) {
  height: 6px;
}

.context-usage-bar:nth-child(3) {
  height: 8px;
}

.context-usage-bar:nth-child(4) {
  height: 11px;
}

.context-usage-bar:nth-child(5) {
  height: 13px;
}

.context-usage-bar--active {
  background: hsl(var(--success));
}

.context-usage--warning {
  color: hsl(var(--warning));
}

.context-usage--warning .context-usage-button {
  border-color: hsl(var(--warning) / 0.35);
  background: hsl(var(--warning) / 0.08);
}

.context-usage--warning .context-usage-bar--active {
  background: hsl(var(--warning));
}

.context-usage--danger {
  color: hsl(var(--error));
}

.context-usage--danger .context-usage-button {
  border-color: hsl(var(--error) / 0.35);
  background: hsl(var(--error) / 0.08);
}

.context-usage--danger .context-usage-bar--active {
  background: hsl(var(--error));
}

.context-usage--empty {
  color: hsl(var(--muted-foreground) / 0.62);
}

.context-usage--empty .context-usage-button {
  border-color: hsl(var(--border) / 0.25);
  background: hsl(var(--muted) / 0.18);
}

.context-usage-popover {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  z-index: 70;
  width: 210px;
  padding: 10px;
  border: 1px solid hsl(var(--border) / 0.65);
  border-radius: 8px;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  box-shadow: 0 14px 30px hsl(0 0% 0% / 0.14);
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, 4px);
  transition:
    opacity 0.12s ease,
    transform 0.12s ease;
}

.context-usage:hover .context-usage-popover,
.context-usage:focus-within .context-usage-popover {
  opacity: 1;
  transform: translate(-50%, 0);
}

.context-usage-popover::after {
  position: absolute;
  bottom: -5px;
  left: 50%;
  width: 9px;
  height: 9px;
  border-right: 1px solid hsl(var(--border) / 0.65);
  border-bottom: 1px solid hsl(var(--border) / 0.65);
  background: hsl(var(--background));
  content: '';
  transform: translateX(-50%) rotate(45deg);
}

.context-usage-popover-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.context-usage-popover-title {
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.context-usage-popover-percent {
  font-size: 12px;
  font-weight: 700;
  color: currentColor;
}

.context-usage-popover-meter {
  position: relative;
  height: 4px;
  margin-bottom: 9px;
  overflow: hidden;
  border-radius: 999px;
  background: hsl(var(--muted) / 0.75);
}

.context-usage-popover-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: currentColor;
  transition: width 0.18s ease;
}

.context-usage-popover-grid {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 5px 12px;
  font-size: 11.5px;
}

.context-usage-popover-grid span {
  color: hsl(var(--muted-foreground));
}

.context-usage-popover-grid strong {
  font-weight: 600;
  color: hsl(var(--foreground));
}

.context-usage-popover-empty {
  margin: 8px 0 0;
  font-size: 11px;
  line-height: 1.4;
  color: hsl(var(--muted-foreground));
}

@media (max-width: 560px) {
  .context-usage-popover {
    left: auto;
    right: 0;
    transform: translateY(4px);
  }

  .context-usage:hover .context-usage-popover,
  .context-usage:focus-within .context-usage-popover {
    transform: translateY(0);
  }

  .context-usage-popover::after {
    left: auto;
    right: 12px;
    transform: rotate(45deg);
  }
}
</style>
