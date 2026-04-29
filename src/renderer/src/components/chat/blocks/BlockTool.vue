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
const updates = computed(() => props.block.tool.updates || []);
const visibleUpdates = computed(() => updates.value.slice(-6));

const previewText = computed(() => {
  const latestUpdate = [...updates.value].reverse().find((item) => item.content.trim());
  if (props.block.tool.status === 'calling' && latestUpdate) {
    return compactText(latestUpdate.content, 132);
  }

  const resultPreview = compactPayload(props.block.tool.result, 132);
  if (resultPreview) return resultPreview;

  if (latestUpdate) {
    return compactText(latestUpdate.content, 132);
  }

  const argsPreview = compactPayload(props.block.tool.arguments, 132);
  if (argsPreview) return argsPreview;

  if (props.block.tool.status === 'calling') return '正在执行工具...';
  if (props.block.tool.status === 'approval-pending') return '等待用户确认后继续';
  return '';
});

const canExpand = computed(() => Boolean(formattedArgs.value || fullResult.value || updates.value.length > 0));

function compactPayload(value: unknown, maxLength = 132): string {
  const normalized = normalizePayload(value);
  if (normalized == null || normalized === '') return '';

  if (typeof normalized === 'string') {
    return compactText(normalized, maxLength);
  }

  if (Array.isArray(normalized)) {
    if (normalized.length === 0) return '';
    const parts = normalized.slice(0, 3).map((item) => compactPayload(item, Math.floor(maxLength / 3)));
    return compactText(parts.filter(Boolean).join(', '), maxLength);
  }

  if (typeof normalized === 'object') {
    const entries = Object.entries(normalized as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined && entryValue !== null && entryValue !== '')
      .slice(0, 4);
    const text = entries.map(([key, entryValue]) => `${formatKey(key)}: ${compactValue(entryValue)}`).join(' · ');
    return compactText(text, maxLength);
  }

  return compactText(String(normalized), maxLength);
}

function compactValue(value: unknown): string {
  const normalized = normalizePayload(value);
  if (typeof normalized === 'string') return compactText(normalized, 52);
  if (typeof normalized === 'number' || typeof normalized === 'boolean') return String(normalized);
  if (Array.isArray(normalized)) return `${normalized.length} 项`;
  if (normalized && typeof normalized === 'object') return '{...}';
  return '';
}

function compactText(value: string, maxLength = 132): string {
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function formatKey(key: string): string {
  const labels: Record<string, string> = {
    path: '路径',
    file: '文件',
    filePath: '文件',
    command: '命令',
    query: '查询',
    q: '查询',
    content: '内容',
    text: '文本',
    event: '事件',
    eventName: '事件',
    title: '标题',
    message: '消息'
  };
  return labels[key] || key;
}

function normalizePayload(value: unknown): unknown {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  if (!trimmed) return '';

  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function formatPayload(value: unknown): string {
  const normalized = normalizePayload(value);
  if (normalized == null || normalized === '') return '';

  if (typeof normalized === 'string') {
    return normalized;
  }

  try {
    return JSON.stringify(normalized, null, 2);
  } catch {
    return String(normalized);
  }
}

function getUpdateLabel(type: string): string {
  if (type === 'output') return '输出';
  if (type === 'result') return '结果';
  return '进度';
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
        <span v-if="previewText" class="tool-preview">{{ previewText }}</span>
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
      <div v-if="visibleUpdates.length" class="tool-section">
        <div class="tool-section-label">执行过程</div>
        <div class="tool-update-list">
          <div v-for="(update, idx) in visibleUpdates" :key="`${update.timestamp}-${idx}`" class="tool-update-item">
            <span class="tool-update-type">{{ getUpdateLabel(update.type) }}</span>
            <span class="tool-update-content">{{ update.content }}</span>
          </div>
        </div>
      </div>

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
  flex-shrink: 0;
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

.tool-preview {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: hsl(var(--muted-foreground) / 0.78);
  font-size: 11.5px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.tool-update-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.tool-update-item {
  display: flex;
  min-width: 0;
  gap: 6px;
  border-radius: 5px;
  background: hsl(var(--muted) / 0.18);
  padding: 5px 7px;
}

.tool-update-type {
  flex-shrink: 0;
  color: hsl(var(--muted-foreground) / 0.72);
  font-size: 10px;
  font-weight: 600;
}

.tool-update-content {
  min-width: 0;
  color: hsl(var(--foreground) / 0.86);
  font-size: 11.5px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
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
