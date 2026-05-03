<script setup lang="ts">
import { ref, computed } from 'vue';
import type { ContentBlock } from '@/types/chat';

const props = defineProps<{
  block: ContentBlock & { type: 'tool' };
}>();

const expanded = ref(false);
const showRawArgs = ref(false);

type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

interface ParsedTodoRow {
  id: string;
  content: string;
  status: TodoStatus;
}

const displayToolName = computed(() => {
  const n = props.block.tool.name;
  if (n === 'todo_write') return '待办列表';
  return n;
});

const isTodoWrite = computed(() => props.block.tool.name === 'todo_write');

function parseTodoWritePayload(raw: unknown): { merge: boolean; todos: ParsedTodoRow[] } | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const todos = o.todos;
  if (!Array.isArray(todos) || todos.length === 0) return null;
  const rows: ParsedTodoRow[] = [];
  for (const item of todos) {
    if (!item || typeof item !== 'object') continue;
    const t = item as Record<string, unknown>;
    const id = typeof t.id === 'string' ? t.id : '';
    const content = typeof t.content === 'string' ? t.content : '';
    const status = t.status as TodoStatus;
    if (!id && !content) continue;
    if (!isValidTodoStatus(status)) continue;
    rows.push({ id: id || '—', content: content || '（无描述）', status });
  }
  return rows.length ? { merge: Boolean(o.merge), todos: rows } : null;
}

const parsedTodoWrite = computed((): { merge: boolean; todos: ParsedTodoRow[] } | null => {
  if (!isTodoWrite.value) return null;
  return parseTodoWritePayload(normalizePayload(props.block.tool.arguments));
});

function isValidTodoStatus(s: unknown): s is TodoStatus {
  return s === 'pending' || s === 'in_progress' || s === 'completed' || s === 'cancelled';
}

function summarizeTodoWriteArgs(args: unknown): string {
  const parsed = parseTodoWritePayload(normalizePayload(args));
  if (!parsed) return '';

  const { todos, merge } = parsed;
  const n = todos.length;
  const by = (s: TodoStatus) => todos.filter((t) => t.status === s).length;
  const mode = merge ? '合并更新' : '替换列表';
  const first = todos[0];
  const head = first?.content ? compactText(first.content, 48) : '';
  const tail = n > 1 ? ` 等 ${n} 项` : '';
  return `${mode} · ${n} 项（进行中 ${by('in_progress')} · 待办 ${by('pending')} · 已完成 ${by('completed')}）${head ? ` · ${head}${tail}` : ''}`;
}

function todoStatusLabel(s: TodoStatus): string {
  const map: Record<TodoStatus, string> = {
    pending: '待办',
    in_progress: '进行中',
    completed: '已完成',
    cancelled: '已取消'
  };
  return map[s] || s;
}

function todoStatusClass(s: TodoStatus): string {
  return `todo-status--${s}`;
}

const formattedArgs = computed(() => formatPayload(props.block.tool.arguments));
const fullResult = computed(() => formatPayload(props.block.tool.result));
const updates = computed(() => props.block.tool.updates || []);
const visibleUpdates = computed(() => updates.value.slice(-6));

const previewText = computed(() => {
  // todo_write：优先用语义化摘要，避免 tool:delta 里的冗长或临时文本盖住参数
  if (props.block.tool.name === 'todo_write') {
    const todoLine = summarizeTodoWriteArgs(props.block.tool.arguments);
    if (todoLine) return todoLine;
  }

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

const canExpand = computed(() =>
  Boolean(
    parsedTodoWrite.value ||
      formattedArgs.value ||
      fullResult.value ||
      updates.value.length > 0
  )
);

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
    message: '消息',
    todos: '任务',
    merge: '合并模式',
    id: '标识',
    status: '状态'
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
        <span
          v-if="isTodoWrite"
          class="tool-icon i-carbon-task"
          aria-hidden="true" />
        <span class="tool-name">{{ displayToolName }}</span>
        <span v-if="previewText" class="tool-preview">{{ previewText }}</span>
        <span v-if="block.tool.status === 'calling'" class="tool-status-badge">执行中</span>
      </div>
      <span
        v-if="canExpand"
        class="tool-expand-icon"
        :class="expanded ? 'i-carbon-chevron-down' : 'i-carbon-chevron-right'" />
    </div>

    <div v-if="expanded && canExpand" class="tool-details">
      <div v-if="parsedTodoWrite" class="tool-section">
        <div class="tool-section-label">任务</div>
        <div class="todo-table">
          <div v-if="parsedTodoWrite.merge" class="todo-merge-hint">合并模式：仅更新下列 id，其余保留</div>
          <div
            v-for="(row, idx) in parsedTodoWrite.todos"
            :key="`${row.id}-${idx}`"
            class="todo-row">
            <span class="todo-id" :title="row.id">{{ row.id }}</span>
            <span class="todo-content">{{ row.content }}</span>
            <span class="todo-status" :class="todoStatusClass(row.status)">{{ todoStatusLabel(row.status) }}</span>
          </div>
        </div>
        <button
          v-if="formattedArgs"
          type="button"
          class="todo-raw-toggle"
          @click.stop="showRawArgs = !showRawArgs">
          {{ showRawArgs ? '隐藏原始参数' : '查看原始参数' }}
        </button>
        <div v-if="showRawArgs && formattedArgs" class="tool-section-content tool-section-content--tight">
          <pre>{{ formattedArgs }}</pre>
        </div>
      </div>

      <div v-if="visibleUpdates.length" class="tool-section">
        <div class="tool-section-label">执行过程</div>
        <div class="tool-update-list">
          <div v-for="(update, idx) in visibleUpdates" :key="`${update.timestamp}-${idx}`" class="tool-update-item">
            <span class="tool-update-type">{{ getUpdateLabel(update.type) }}</span>
            <span class="tool-update-content">{{ update.content }}</span>
          </div>
        </div>
      </div>

      <div v-if="formattedArgs && !parsedTodoWrite" class="tool-section">
        <div class="tool-section-label">参数</div>
        <div class="tool-section-content">
          <pre>{{ formattedArgs }}</pre>
        </div>
      </div>

      <div v-if="fullResult" class="tool-section">
        <div class="tool-section-label">执行结果</div>
        <div
          class="tool-section-content"
          :class="{ 'tool-result--todo': isTodoWrite }">
          <pre v-if="isTodoWrite" class="tool-result-pre-todo">{{ fullResult }}</pre>
          <pre v-else>{{ fullResult }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-wrapper {
  display: flex;
  flex-direction: column;
  align-self: flex-start;
  width: min(100%, 680px);
  overflow: visible;
  border: none;
  border-radius: 0;
  background: transparent;
}

.tool-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-height: 26px;
  padding: 3px 0;
  transition: color 0.15s;
}

.tool-header--clickable {
  cursor: pointer;
}

.tool-header--clickable:hover {
  color: hsl(var(--foreground) / 0.72);
}

.tool-header-left {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 7px;
}

.tool-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: hsl(var(--muted-foreground) / 0.55);
}

.tool-name {
  flex-shrink: 0;
  color: hsl(var(--muted-foreground) / 0.64);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1.35;
}

.tool-status-badge {
  flex-shrink: 0;
  border-radius: 999px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
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

.tool-expand-icon {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  color: hsl(var(--muted-foreground) / 0.5);
  transition: transform 0.2s;
}

.tool-details {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 4px -8px 0;
  padding: 8px;
  border: 1px solid hsl(var(--border) / 0.42);
  border-radius: 7px;
  background: hsl(var(--muted) / 0.1);
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

.tool-section-content--tight pre {
  max-height: 160px;
  font-size: 11px;
}

.todo-merge-hint {
  margin-bottom: 6px;
  color: hsl(var(--muted-foreground) / 0.9);
  font-size: 11px;
  line-height: 1.35;
}

.todo-table {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.todo-row {
  display: grid;
  grid-template-columns: minmax(72px, 0.22fr) minmax(0, 1fr) auto;
  gap: 8px;
  align-items: start;
  border-radius: 6px;
  background: hsl(var(--card) / 0.45);
  border: 1px solid hsl(var(--border) / 0.35);
  padding: 7px 9px;
}

.todo-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10.5px;
  color: hsl(var(--muted-foreground) / 0.85);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.todo-content {
  font-size: 12px;
  line-height: 1.45;
  color: hsl(var(--foreground) / 0.92);
  word-break: break-word;
}

.todo-status {
  flex-shrink: 0;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.3;
  white-space: nowrap;
}

.todo-status--pending {
  background: hsl(var(--muted) / 0.35);
  color: hsl(var(--muted-foreground));
}

.todo-status--in_progress {
  background: hsl(var(--primary) / 0.12);
  color: hsl(var(--primary));
}

.todo-status--completed {
  background: hsl(var(--success) / 0.14);
  color: hsl(var(--success));
}

.todo-status--cancelled {
  background: hsl(var(--destructive) / 0.1);
  color: hsl(var(--destructive) / 0.9);
}

.todo-raw-toggle {
  align-self: flex-start;
  margin-top: 8px;
  border: none;
  background: transparent;
  color: hsl(var(--muted-foreground));
  font-size: 11px;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
  padding: 0;
}

.todo-raw-toggle:hover {
  color: hsl(var(--foreground) / 0.8);
}

.tool-result--todo .tool-result-pre-todo {
  font-size: 11.5px;
  line-height: 1.5;
  max-height: 320px;
}
</style>
