<script setup lang="ts">
/**
 * BlockThinking — 思考过程块
 *
 * 渲染 AI 的推理过程，支持折叠/展开。
 */

import { ref, computed } from 'vue';

const props = defineProps<{
  text: string;
}>();

/** 是否折叠 */
const isCollapsed = ref(true);

/** 是否为空 */
const isEmpty = computed(() => !props.text.trim());

/** 切换折叠状态 */
function toggleCollapse(): void {
  isCollapsed.value = !isCollapsed.value;
}
</script>

<template>
  <div
    v-if="!isEmpty"
    class="rounded-[10px] bg-muted/20 overflow-hidden">
    <div
      class="flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors duration-150 hover:bg-muted/30 select-none"
      @click="toggleCollapse">
      <div class="flex items-center justify-center text-muted-foreground/60">
        <span class="i-carbon-circle-dash inline-block h-3 w-3" />
      </div>
      <span class="flex-1 text-xs font-medium text-muted-foreground/80">推理过程</span>
      <span
        class="flex items-center justify-center text-muted-foreground/50 transition-transform duration-200"
        :class="{ '-rotate-90': isCollapsed }">
        <span class="i-carbon-chevron-down inline-block h-3 w-3" />
      </span>
    </div>

    <div
      v-if="!isCollapsed"
      class="px-3 py-3 border-t border-border/30 text-xs leading-relaxed text-muted-foreground/90 whitespace-pre-wrap break-words">
      {{ text }}
    </div>
  </div>
</template>
