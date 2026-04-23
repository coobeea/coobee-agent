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
  if (status === 'calling') return 'text-blue-500';
  if (status === 'approval-pending') return 'text-orange-500';
  if (status === 'done') return 'text-green-600';
  return 'text-red-500';
});

const statusText = computed(() => {
  const status = props.block.tool.status;
  if (status === 'calling') return '执行中';
  if (status === 'approval-pending') return '等待审批';
  if (status === 'done') return '完成';
  return '失败';
});

// 是否可以展开
const canExpand = computed(() => {
  return props.block.tool.status === 'done' && props.block.tool.result;
});

// 格式化参数
const formattedArgs = computed(() => {
  if (!props.block.tool.arguments) return null;
  try {
    const args =
      typeof props.block.tool.arguments === 'string'
        ? JSON.parse(props.block.tool.arguments)
        : props.block.tool.arguments;
    return JSON.stringify(args, null, 2);
  } catch {
    return props.block.tool.arguments;
  }
});

// 完整结果
const fullResult = computed(() => {
  return props.block.tool.result ? String(props.block.tool.result) : '';
});
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

    <!-- 展开的详细内容 -->
    <div v-if="expanded && canExpand" class="tool-details">
      <!-- 参数 -->
      <div v-if="formattedArgs" class="tool-section">
        <div class="tool-section-label">参数</div>
        <div class="tool-section-content">
          <pre>{{ formattedArgs }}</pre>
        </div>
      </div>

      <!-- 执行结果 -->
      <div class="tool-section">
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
  border: 1px solid hsl(var(--border) / 0.45);
  border-radius: 7px;
  overflow: hidden;
  background: hsl(var(--muted) / 0.16);
}

.tool-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 10px;
  gap: 6px;
  transition: background-color 0.15s;
}

.tool-header--clickable {
  cursor: pointer;
}

.tool-header--clickable:hover {
  background: hsl(var(--muted) / 0.32);
}

.tool-header-left {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.tool-status-icon {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
}

.tool-name {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12.5px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.tool-status-badge {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 10px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.tool-status-badge--calling {
  background: hsl(210 100% 90%);
  color: hsl(210 100% 40%);
}

.tool-status-badge--done {
  background: hsl(142 70% 90%);
  color: hsl(142 70% 35%);
}

.tool-status-badge--error {
  background: hsl(0 70% 95%);
  color: hsl(0 70% 45%);
}

.tool-status-badge--approval-pending {
  background: hsl(35 90% 90%);
  color: hsl(35 90% 40%);
}

.tool-expand-icon {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  color: hsl(var(--muted-foreground));
  transition: transform 0.2s;
}

.tool-details {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-top: 1px solid hsl(var(--border) / 0.45);
  background: hsl(var(--background));
}

.tool-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tool-section-label {
  font-size: 10px;
  font-weight: 600;
  color: hsl(var(--muted-foreground));
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.tool-section-content {
  border-radius: 5px;
  overflow: hidden;
}

.tool-section-content pre {
  margin: 0;
  padding: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.45;
  color: hsl(var(--foreground));
  background: hsl(var(--muted) / 0.3);
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
