<script setup lang="ts">
/**
 * HitlApprovalCard — HITL 审批卡片（通用）
 *
 * 渲染单个待审批/已审批的工具审批项。
 * 被 ChatPanel 和 CopilotBubble 共同使用。
 */

import type { PendingApproval } from '@/types/chat';
import type { HitlApprovalDecision } from '@shared/stream-protocol';

const props = defineProps<{
  approval: PendingApproval;
}>();

const emit = defineEmits<{
  decide: [decision: HitlApprovalDecision];
}>();

function decisionLabel(decision: HitlApprovalDecision): string {
  switch (decision) {
    case 'approve-once':
      return '已允许';
    case 'approve-always':
      return '始终允许';
    case 'reject':
      return '已拒绝';
  }
}
</script>

<template>
  <!-- 已决策 — 压缩为单行摘要 -->
  <div
    v-if="props.approval.decision"
    class="hitl-decided"
    :class="props.approval.decision === 'reject' ? 'hitl-decided--rejected' : 'hitl-decided--approved'">
    <span
      class="inline-block h-2.5 w-2.5"
      :class="props.approval.decision === 'reject' ? 'i-carbon-close-filled' : 'i-carbon-checkmark-filled'" />
    <span>{{ decisionLabel(props.approval.decision) }}</span>
    <span class="font-mono text-muted-foreground/65">{{ props.approval.toolName }}</span>
  </div>

  <!-- 未决策 — 完整展开 -->
  <div v-else class="hitl-pending">
    <div class="hitl-pending-header">
      <span class="i-carbon-locked inline-block h-3 w-3 text-warning" />
      <span class="hitl-pending-title">需要审批</span>
      <span class="font-mono text-[10px] text-muted-foreground/65">{{ props.approval.toolName }}</span>
    </div>

    <div class="hitl-pending-actions">
      <button class="hitl-btn hitl-btn--approve" @click="emit('decide', 'approve-once')">允许</button>
      <button class="hitl-btn hitl-btn--always" @click="emit('decide', 'approve-always')">始终允许</button>
      <button class="hitl-btn hitl-btn--reject" @click="emit('decide', 'reject')">拒绝</button>
    </div>
  </div>
</template>

<style scoped>
.hitl-decided {
  display: flex;
  align-items: center;
  gap: 5px;
  border-radius: 5px;
  padding: 3px 7px;
  font-size: 11.5px;
}

.hitl-decided--approved {
  background: hsl(var(--success) / 0.1);
  color: hsl(var(--success));
}

.hitl-decided--rejected {
  background: hsl(var(--error) / 0.1);
  color: hsl(var(--error));
}

.hitl-pending {
  border-radius: 6px;
  border-left: 2px solid hsl(var(--warning));
  background: hsl(var(--warning) / 0.08);
  padding: 7px;
}

.hitl-pending-header {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 4px;
}

.hitl-pending-title {
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--foreground) / 0.82);
}

.hitl-pending-actions {
  display: flex;
  gap: 5px;
  margin-top: 7px;
}

.hitl-btn {
  border-radius: 4px;
  padding: 2px 7px;
  font-size: 10px;
  font-weight: 500;
  color: white;
  cursor: pointer;
  transition: background-color 150ms;
}

.hitl-btn--approve {
  background: hsl(var(--success));
}
.hitl-btn--approve:hover {
  background: hsl(var(--success) / 0.86);
}

.hitl-btn--always {
  background: hsl(var(--primary));
}
.hitl-btn--always:hover {
  background: hsl(var(--primary) / 0.9);
}

.hitl-btn--reject {
  background: hsl(var(--error));
}
.hitl-btn--reject:hover {
  background: hsl(var(--error) / 0.9);
}
</style>
