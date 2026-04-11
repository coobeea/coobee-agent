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
  <div class="status-bar">
    <!-- 左侧状态区 -->
    <div class="status-section">
      <div class="status-item-disabled">
        <span class="i-carbon-application inline-block h-3.5 w-3.5" />
        <span>无服务</span>
      </div>
    </div>

    <!-- 右侧快捷按钮 -->
    <div class="actions-section">
      <button class="action-btn" :class="{ active: activeMenuId === 'settings' }" title="设置" @click="handleSettings">
        <span class="i-carbon-settings inline-block h-3.5 w-3.5" />
        <span>设置</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  flex-shrink: 0;
  padding: 0 12px;
  background: hsl(var(--surface));
  border-top: 1px solid hsl(var(--border) / 0.4);
}

/* 左侧状态区 */
.status-section {
  display: flex;
  align-items: center;
  gap: 2px;
}

.status-item-disabled {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
  color: hsl(var(--muted-foreground) / 0.4);
  user-select: none;
}

/* 右侧操作按钮 */
.actions-section {
  display: flex;
  align-items: center;
  gap: 2px;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 12px;
  color: hsl(var(--muted-foreground) / 0.6);
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
}

.action-btn:hover {
  background: hsl(var(--foreground) / 0.04);
  color: hsl(var(--foreground) / 0.8);
}

.action-btn.active {
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
  font-weight: 500;
}
</style>
