<script setup lang="ts">
/**
 * BlockText — 文本内容块
 *
 * 渲染 AI 的文本内容，支持 Markdown 渲染。
 */

import { computed } from 'vue';

const props = defineProps<{
  text: string;
}>();

/** 是否为空 */
const isEmpty = computed(() => !props.text.trim());
</script>

<template>
  <div
    v-if="!isEmpty"
    class="rounded-[10px] bg-muted/30 px-3 py-2.5 text-[13px] leading-relaxed text-foreground/92 break-words">
    <div class="whitespace-pre-wrap">{{ text }}</div>
  </div>
</template>
