<script setup lang="ts">
/**
 * App.vue — 根组件（Tab 内容区域）
 *
 * 这是 Tab 内容区域的根组件，被嵌入到 Shell 窗口的 WebContentsView 中。
 * 当前保持最简结构，只包含基础的路由视图。
 */

import { ref, onMounted, onUnmounted } from 'vue';
import eventBus from '@/eventbus';
import { EventTypes } from '@shared/ipc/events';

const isReady = ref(false);
let timeoutId: ReturnType<typeof setTimeout> | null = null;

function markReady(): void {
  if (isReady.value) return;
  isReady.value = true;
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
}

function onBackendReady(): void {
  markReady();
}

onMounted(async () => {
  // 监听后端就绪事件
  eventBus.once(EventTypes.BACKEND_READY, onBackendReady);

  // 主动查询后端状态
  try {
    const ready = await window.api?.isBackendReady?.();
    if (ready) {
      markReady();
      return;
    }
  } catch {
    markReady();
    return;
  }

  // 超时兜底
  timeoutId = setTimeout(() => {
    markReady();
  }, 5000);
});

onUnmounted(() => {
  eventBus.off(EventTypes.BACKEND_READY, onBackendReady);
  if (timeoutId) clearTimeout(timeoutId);
});
</script>

<template>
  <!-- 加载中 -->
  <Transition name="fade">
    <div v-if="!isReady" class="app-loading">
      <div class="loading-spinner" />
      <p class="loading-text">加载中...</p>
    </div>
  </Transition>

  <!-- 真实内容 -->
  <div v-if="isReady" class="flex h-full w-full flex-col overflow-hidden bg-gray-50">
    <router-view />
  </div>
</template>

<style scoped>
.app-loading {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: hsl(var(--background, 0 0% 100%));
  z-index: 99999;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid hsl(var(--border, 0 0% 90%));
  border-top-color: hsl(var(--primary, 220 90% 56%));
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.loading-text {
  margin-top: 16px;
  font-size: 14px;
  color: hsl(var(--muted-foreground, 0 0% 45%));
  letter-spacing: 0.5px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-leave-to {
  opacity: 0;
}
</style>
