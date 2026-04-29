<script setup lang="ts">
/**
 * StatusBar — 全局底部状态栏
 *
 * 显示：
 *   1. Worker 服务状态
 *   2. 设置入口
 */

import { computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useWorkerStore } from '@/stores/worker';
import type { WorkerInfo, WorkerStatus } from '@shared/events';

const router = useRouter();
const route = useRoute();
const workerStore = useWorkerStore();

const activeMenuId = computed(() => route.name as string);

function handleSettings(): void {
  router.push('/settings');
}

function openWorkerSettings(): void {
  router.push({
    path: '/settings',
    query: {
      section: 'workers'
    }
  });
}

function statusLabel(status: WorkerStatus): string {
  switch (status) {
    case 'stopped':
      return '未启动';
    case 'initializing':
      return '初始化';
    case 'starting':
      return '启动中';
    case 'ready':
      return '就绪';
    case 'error':
      return '异常';
    case 'stopping':
      return '停止中';
    default:
      return status;
  }
}

function statusDotClass(status: WorkerStatus): string {
  switch (status) {
    case 'ready':
      return 'bg-success';
    case 'initializing':
    case 'starting':
      return 'bg-warning';
    case 'error':
      return 'bg-error';
    case 'stopping':
      return 'bg-muted-foreground';
    default:
      return 'bg-muted-foreground/35';
  }
}

function workerIcon(name: string): string {
  switch (name) {
    case 'asr':
      return 'i-carbon-microphone';
    case 'tts':
      return 'i-carbon-volume-up';
    case 'ocr':
      return 'i-carbon-image-search';
    default:
      return 'i-carbon-application';
  }
}

function canToggleWorker(worker: WorkerInfo): boolean {
  return worker.status === 'stopped' || worker.status === 'error' || worker.status === 'ready';
}

function workerTitle(worker: WorkerInfo): string {
  const action =
    worker.status === 'stopped' || worker.status === 'error'
      ? '点击启动'
      : worker.status === 'ready'
        ? '点击停止'
        : '正在处理';
  return `${worker.label}: ${statusLabel(worker.status)} · ${action}`;
}

function handleWorkerClick(worker: WorkerInfo): void {
  if (!canToggleWorker(worker)) return;

  if (worker.status === 'stopped' || worker.status === 'error') {
    void workerStore.startWorker(worker.name);
    return;
  }

  if (worker.status === 'ready') {
    void workerStore.stopWorker(worker.name);
  }
}

onMounted(() => {
  void workerStore.requestWorkers();
});
</script>

<template>
  <div class="flex h-9 shrink-0 items-center justify-between border-t border-border bg-surface px-3">
    <!-- 左侧状态区 -->
    <div class="flex min-w-0 items-center gap-0.5">
      <button
        v-for="worker in workerStore.workerList"
        :key="worker.name"
        class="flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2.5 text-xs text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground/85 disabled:cursor-default disabled:opacity-70 disabled:hover:bg-transparent disabled:hover:text-muted-foreground/70"
        type="button"
        :disabled="!canToggleWorker(worker)"
        :title="workerTitle(worker)"
        @click="handleWorkerClick(worker)">
        <span :class="[workerIcon(worker.name), 'inline-block h-3.5 w-3.5 shrink-0']" />
        <span class="max-w-20 truncate">{{ worker.label }}</span>
        <span class="h-1.5 w-1.5 shrink-0 rounded-full" :class="statusDotClass(worker.status)" />
      </button>

      <button
        v-if="!workerStore.loading && workerStore.workerList.length === 0"
        class="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs text-muted-foreground/40 transition-colors hover:bg-foreground/5 hover:text-muted-foreground/75"
        type="button"
        title="打开内置服务设置"
        @click="openWorkerSettings">
        <span class="i-carbon-application inline-block h-3.5 w-3.5" />
        <span>无服务</span>
      </button>

      <div v-if="workerStore.loading" class="flex h-7 items-center gap-1.5 px-2.5 text-xs text-muted-foreground/60">
        <span class="i-carbon-circle-dash inline-block h-3.5 w-3.5 animate-spin" />
        <span>服务同步中</span>
      </div>
    </div>

    <!-- 右侧快捷按钮 -->
    <div class="flex items-center gap-0.5">
      <button
        class="flex h-7 cursor-pointer select-none items-center gap-1.5 rounded-md px-2.5 text-xs text-muted-foreground/60 transition-all duration-150 hover:bg-foreground/5 hover:text-foreground/80"
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
