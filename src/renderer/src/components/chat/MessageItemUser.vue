<script setup lang="ts">
/**
 * MessageItemUser — 用户消息
 */

import type { StreamChatMessage } from '@/types/chat';

defineProps<{
  message: StreamChatMessage;
}>();
</script>

<template>
  <div class="flex gap-2.5">
    <div class="flex items-center justify-center w-7 h-7 rounded-[7px] bg-muted/40 text-foreground/60 shrink-0">
      <span class="i-carbon-user inline-block h-3.5 w-3.5" />
    </div>
    <div class="flex-1 flex flex-col gap-2">
      <div
        v-for="(block, idx) in message.blocks"
        :key="idx"
        class="px-3 py-2.5 rounded-[10px] text-[13px] leading-relaxed break-words bg-primary/8 text-foreground/95 whitespace-pre-wrap">
        {{ block.text }}
      </div>
    </div>
  </div>
</template>
