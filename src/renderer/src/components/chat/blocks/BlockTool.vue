<script setup lang="ts">
import { ref, computed } from 'vue';
import type { ContentBlock } from '@/types/chat';

const props = defineProps<{
  block: ContentBlock & { type: 'tool' };
}>();

const expanded = ref(false);

const statusIconClass = computed(() => {
  const status = props.block.tool.status;
  if (status === 'calling') return 'i-carbon-renew animate-spin';
  if (status === 'approval-pending') return 'i-carbon-locked';
  if (status === 'done') return 'i-carbon-checkmark-filled';
  return 'i-carbon-warning-alt';
});

const statusColor = computed(() => {
  const status = props.block.tool.status;
  if (status === 'calling') return 'tool-status-icon--calling';
  if (status === 'approval-pending') return 'tool-status-icon--approval-pending';
  if (status === 'done') return 'tool-status-icon--done';
  return 'tool-status-icon--error';
});

const statusText = computed(() => {
  const status = props.block.tool.status;
  if (status === 'calling') return '执行中';
  if (status === 'approval-pending') return '等待审批';
  if (status === 'done') return '完成';
  return '失败';
});

const formattedArgs = computed(() => formatPayload(props.block.tool.arguments));
const fullResult = computed(() => formatPayload(props.block.tool.result));

const canExpand = computed(() => Boolean(formattedArgs.value || fullResult.value));

function formatPayload(value: unknown): string {
  if (value == null || value === '') return '';

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';

    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return trimmed;
    }
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
</script>

<template>
  <div class="tool-wrapper">
    <div
      class="tool-header"
      :class="{ 'tool-header--clickable': canExpand }"
      @click="canExpand && (expanded = !expanded)">
      <div class="tool-header-left">
        <span class="tool-status-icon" :class="[statusIconClass, statusColor]" />
        <span class="tool-name">{{ block.tool.name }}</span>
        <span class="tool-status-badge" :class="`tool-status-badge--${block.tool.status}`">
          {{ statusText }}
        </span>
      </div>
      <span
        v-if="canExpand"
        class="tool-expand-icon"
        :class="expanded ? 'i-carbon-chevron-up' : 'i-carbon-chevron-down'" />
    </div>

    <div v-if="expanded && canExpand" class="tool-details">
      <div v-if="formattedArgs" class="tool-section">
        <div class="tool-section-label">参数</div>
        <div class="tool-section-content">
          <pre>{{ formattedArgs }}</pre>
        </div>
      </div>

      <div v-if="fullResult" class="tool-section">
        <div class="tool-section-label">执行结果</div>
        <div class="tool-section-content">
          <pre>{{ fullResult }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-wrapper {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  align-self: flex-start;
  width: min(100%, 680px);
  border: 1px solid hsl(var(--border) / 0.5);
  border-radius: 7px;
  background: hsl(var(--muted) / 0.12);
}

.tool-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-height: 32px;
  padding: 6px 9px;
  transition: background-color 0.15s;
}

.tool-header--clickable {
  cursor: pointer;
}

.tool-header--clickable:hover {
  background: hsl(var(--muted) / 0.24);
}

.tool-header-left {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 7px;
}

.tool-status-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.tool-status-icon--calling {
  color: hsl(var(--primary));
}

.tool-status-icon--approval-pending {
  color: hsl(var(--chart-4, var(--primary)));
}

.tool-status-icon--done {
  color: hsl(var(--chart-2, var(--primary)));
}

.tool-status-icon--error {
  color: hsl(var(--destructive));
}

.tool-name {
  color: hsl(var(--foreground));
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  font-weight: 600;
}

.tool-status-badge {
  flex-shrink: 0;
  border-radius: 999px;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 600;
}

.tool-status-badge--calling {
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}

.tool-status-badge--done {
  background: hsl(var(--chart-2, var(--primary)) / 0.1);
  color: hsl(var(--chart-2, var(--primary)));
}

.tool-status-badge--error {
  background: hsl(var(--destructive) / 0.1);
  color: hsl(var(--destructive));
}

.tool-status-badge--approval-pending {
  background: hsl(var(--chart-4, var(--primary)) / 0.1);
  color: hsl(var(--chart-4, var(--primary)));
}

.tool-expand-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: hsl(var(--muted-foreground) / 0.75);
  transition: transform 0.2s;
}

.tool-details {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid hsl(var(--border) / 0.42);
  background: hsl(var(--background) / 0.65);
  padding: 9px;
}

.tool-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tool-section-label {
  color: hsl(var(--muted-foreground));
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.tool-section-content {
  overflow: hidden;
  border-radius: 5px;
}

.tool-section-content pre {
  margin: 0;
  max-height: 280px;
  overflow-x: auto;
  background: hsl(var(--muted) / 0.22);
  color: hsl(var(--foreground));
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.45;
  padding: 8px;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
