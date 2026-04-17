<script setup lang="ts">
/**
 * MessageItemAssistant — AI 消息
 *
 * 负责渲染 AI 消息的各种内容块（text, thinking, tool）
 */

import type { StreamChatMessage } from '@/types/chat';
import BlockText from './blocks/BlockText.vue';
import BlockThinking from './blocks/BlockThinking.vue';
import BlockTool from './blocks/BlockTool.vue';

defineProps<{
  message: StreamChatMessage;
}>();
</script>

<template>
  <div class="flex gap-2.5">
    <div class="flex items-center justify-center w-7 h-7 rounded-[7px] bg-primary/12 text-primary/70 shrink-0">
      <span class="i-carbon-bot inline-block h-3.5 w-3.5" />
    </div>
    <div class="flex-1 flex flex-col gap-2">
      <!-- 遍历所有内容块 -->
      <div
        v-for="(block, idx) in message.blocks"
        :key="idx">
        <!-- 文本块 -->
        <BlockText
          v-if="block.type === 'text'"
          :text="block.text || ''" />

        <!-- 思考块 -->
        <BlockThinking
          v-else-if="block.type === 'thinking'"
          :text="block.text || ''" />

        <!-- 工具调用块 -->
        <BlockTool
          v-else-if="block.type === 'tool' && block.tool"
          :tool="block.tool" />
      </div>

      <!-- 错误状态 -->
      <div
        v-if="message.status === 'error'"
        class="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-error/8 text-error text-xs font-medium">
        <span class="i-carbon-warning-alt inline-block h-3 w-3" />
        <span>响应失败</span>
      </div>
    </div>
  </div>
</template>
