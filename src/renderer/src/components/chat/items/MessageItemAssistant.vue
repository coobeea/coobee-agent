<script setup lang="ts">
import type { ChatMessage } from '../ChatMessages.vue';
import type { PendingApproval } from '@/types/chat';
import type { HitlApprovalDecision } from '@shared/stream-protocol';
import BlockText from '../blocks/BlockText.vue';
import BlockThinking from '../blocks/BlockThinking.vue';
import BlockTool from '../blocks/BlockTool.vue';
import BlockDelegate from '../blocks/BlockDelegate.vue';
import BlockQuality from '../blocks/BlockQuality.vue';
import BlockAudio from '../blocks/BlockAudio.vue';
import BlockStats from '../blocks/BlockStats.vue';
import HitlApprovalCard from '../HitlApprovalCard.vue';

withDefaults(
  defineProps<{
    message: ChatMessage;
    assistantName?: string;
  }>(),
  {
    assistantName: '智能体'
  }
);

const emit = defineEmits<{
  decide: [approval: PendingApproval, decision: HitlApprovalDecision];
}>();
</script>

<template>
  <div class="msg-block" :class="{ 'msg-block--with-stats': message.status === 'done' && message.stats }">
    <div class="msg-role-row">
      <span class="msg-role-icon msg-role-assistant">
        <span class="inline-block h-3 w-3 i-mdi-star-four-points" />
      </span>
      <span class="msg-role-name">{{ assistantName }}</span>
    </div>

    <div class="msg-content">
      <template v-if="message.blocks && message.blocks.length > 0">
        <template v-for="(block, idx) in message.blocks" :key="idx">
          <BlockText v-if="block.type === 'text'" :block="block" />
          <BlockThinking v-else-if="block.type === 'thinking'" :block="block" />
          <BlockTool v-else-if="block.type === 'tool'" :block="block" />
          <BlockDelegate v-else-if="block.type === 'delegate'" :block="block" />
          <BlockQuality v-else-if="block.type === 'quality'" :block="block" />
          <BlockAudio v-else-if="block.type === 'audio'" :block="block" />
        </template>
      </template>

      <div v-else-if="message.status === 'streaming'" class="msg-typing">
        <span class="typing-dot" /><span class="typing-dot" /><span class="typing-dot" />
      </div>

      <!-- HITL 审批卡片（必须等到 run:done 后才显示） -->
      <template v-if="message.pendingApprovals?.length">
        <HitlApprovalCard
          v-for="approval in message.pendingApprovals.filter((a) => a.canShow)"
          :key="'hitl-' + approval.index"
          :approval="approval"
          @decide="(d) => emit('decide', approval, d)" />
      </template>

      <div v-if="message.status === 'error' && message.error" class="msg-error">
        <span class="i-carbon-warning-alt inline-block h-3 w-3 shrink-0" />
        {{ message.error }}
      </div>

      <div v-if="message.status === 'interrupted'" class="msg-interrupted">
        <span class="i-carbon-pause-filled inline-block h-2.5 w-2.5" />
        <span>已中断</span>
      </div>

      <!-- 执行统计 -->
      <BlockStats
        v-if="message.status === 'done' && message.stats"
        :stats="message.stats"
        :message-content="message.content" />
    </div>
  </div>
</template>

<style scoped>
/* 消息块 */
.msg-block {
  position: relative;
  padding: 5px 12px;
}

.msg-block--with-stats {
  padding-bottom: 30px;
}

.msg-role-row {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 3px;
}

.msg-role-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 4px;
}

.msg-role-assistant {
  background: hsl(var(--foreground) / 0.1);
  color: hsl(var(--foreground) / 0.7);
}

.msg-role-name {
  font-size: 12.5px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.msg-content {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.msg-block :deep(.stats-bar) {
  position: absolute;
  left: 12px;
  bottom: 5px;
  z-index: 6;
  max-width: min(calc(100% - 24px), 560px);
  margin-top: 0;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-3px);
  transition:
    opacity 0.14s ease,
    transform 0.14s ease;
}

.msg-block:hover :deep(.stats-bar),
.msg-block:focus-within :deep(.stats-bar) {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

/* 错误与状态 */
.msg-error {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: hsl(var(--destructive));
  background: hsl(var(--destructive) / 0.1);
  padding: 5px 9px;
  border-radius: 6px;
}

.msg-interrupted {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: hsl(var(--warning));
  background: hsl(var(--warning) / 0.1);
  padding: 2px 6px;
  border-radius: 4px;
  align-self: flex-start;
}

/* 打字动画 */
.msg-typing {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding-left: 4px;
}

.typing-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: hsl(var(--muted-foreground) / 0.5);
  animation: typing 1.4s infinite ease-in-out both;
}

.typing-dot:nth-child(1) {
  animation-delay: -0.32s;
}
.typing-dot:nth-child(2) {
  animation-delay: -0.16s;
}

@keyframes typing {
  0%,
  80%,
  100% {
    transform: scale(0);
    opacity: 0.5;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
