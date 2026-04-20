<script setup lang="ts">
/**
 * StatusBar — 全局底部状态栏
 *
 * 显示：
 *   1. 服务状态（无服务提示）
 *   2. 设置入口
 */

import { computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';

const router = useRouter();
const route = useRoute();

const activeMenuId = computed(() => route.name as string);

function handleSettings(): void {
  router.push('/settings');
}
</script>

<template>
  <div class="flex items-center justify-between h-9 shrink-0 px-3 bg-surface border-t border-border">
    <!-- 左侧状态区 -->
    <div class="flex items-center gap-0.5">
      <div class="flex items-center gap-1.5 h-7 px-2.5 text-xs text-muted-foreground/40 select-none">
        <span class="i-carbon-application inline-block h-3.5 w-3.5" />
        <span>无服务</span>
      </div>
    </div>

    <!-- 右侧快捷按钮 -->
    <div class="flex items-center gap-0.5">
      <button
        class="flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs text-muted-foreground/60 cursor-pointer transition-all duration-150 select-none hover:bg-foreground/5 hover:text-foreground/80"
        :class="{
          'bg-primary/10 text-primary font-medium hover:bg-primary/10 hover:text-primary': activeMenuId === 'settings'
        }"
        title="设置"
        @click="handleSettings">
        <span class="i-carbon-settings inline-block h-3.5 w-3.5" />
        <span>设置</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Scoped styles removed in favor of Tailwind utility classes */
</style>
