<script setup lang="ts">
/**
 * BlockTool — 工具调用块
 *
 * 渲染工具调用信息，包括状态、参数和结果。
 */

import { computed } from 'vue';
import type { ToolCall } from '@/types/chat';

const props = defineProps<{
  tool: ToolCall;
}>();

/** 状态图标 */
const statusIcon = computed(() => {
  switch (props.tool.status) {
    case 'calling':
      return 'i-carbon-renew animate-spin';
    case 'approval-pending':
      return 'i-carbon-pause-outline';
    case 'done':
      return 'i-carbon-checkmark';
    case 'error':
      return 'i-carbon-warning-alt';
    default:
      return 'i-carbon-tool';
  }
});

/** 状态文本 */
const statusText = computed(() => {
  switch (props.tool.status) {
    case 'calling':
      return '执行中';
    case 'approval-pending':
      return '等待审批';
    case 'done':
      return '完成';
    case 'error':
      return '失败';
    default:
      return '';
  }
});

/** 状态颜色类 */
const statusColorClass = computed(() => {
  switch (props.tool.status) {
    case 'calling':
      return 'text-primary';
    case 'approval-pending':
      return 'text-warning';
    case 'done':
      return 'text-success';
    case 'error':
      return 'text-error';
    default:
      return '';
  }
});
</script>

<template>
  <div class="rounded-[10px] bg-muted/20 border border-border/30 overflow-hidden">
    <div class="flex items-center gap-2 px-3 py-2 bg-muted/15">
      <div
        class="flex items-center justify-center"
        :class="statusColorClass">
        <span
          class="inline-block h-3 w-3"
          :class="statusIcon" />
      </div>
      <span class="flex-1 text-xs font-semibold text-foreground/90 font-mono">
        {{ tool.name || '工具调用' }}
      </span>
      <span class="text-[11px] text-muted-foreground/70">{{ statusText }}</span>
    </div>

    <!-- 参数 -->
    <div
      v-if="tool.arguments"
      class="px-3 py-2.5 border-t border-border/20">
      <div class="text-[11px] font-semibold text-muted-foreground/70 mb-1.5 uppercase tracking-wide">
        参数
      </div>
      <div class="text-xs leading-relaxed text-foreground/85 whitespace-pre-wrap break-words font-mono bg-background px-2 py-2 rounded-md">
        {{ tool.arguments }}
      </div>
    </div>

    <!-- 结果 -->
    <div
      v-if="tool.result"
      class="px-3 py-2.5 border-t border-border/20">
      <div class="text-[11px] font-semibold text-muted-foreground/70 mb-1.5 uppercase tracking-wide">
        结果
      </div>
      <div class="text-xs leading-relaxed text-foreground/85 whitespace-pre-wrap break-words">
        {{ tool.result }}
      </div>
    </div>

    <!-- 错误 -->
    <div
      v-if="tool.error"
      class="px-3 py-2.5 border-t border-border/20 bg-error/5">
      <div class="text-[11px] font-semibold text-muted-foreground/70 mb-1.5 uppercase tracking-wide">
        错误
      </div>
      <div class="text-xs leading-relaxed text-foreground/85 whitespace-pre-wrap break-words">
        {{ tool.error }}
      </div>
    </div>
  </div>
</template>
