<script setup lang="ts">
/**
 * WorkersSettings - 内置服务管理设置
 *
 * 显示所有内置服务（Worker）的状态，支持启动/停止和模型配置
 */

import { ref, onMounted } from 'vue';

interface WorkerStatus {
  name: string;
  label: string;
  running: boolean;
  healthy: boolean;
  port?: number;
  pid?: number;
  uptime?: number;
}

const workers = ref<WorkerStatus[]>([]);
const loading = ref(true);
const operationLoading = ref<string | null>(null);

// 模拟加载数据
async function loadData(): Promise<void> {
  loading.value = true;
  try {
    // TODO: 对接实际的 API
    await new Promise(resolve => setTimeout(resolve, 800));
    
    workers.value = [
      {
        name: 'python-worker',
        label: 'Python 代码执行器',
        running: true,
        healthy: true,
        port: 8081,
        pid: 12345,
        uptime: 3600
      },
      {
        name: 'node-worker',
        label: 'Node.js 沙箱',
        running: false,
        healthy: false
      },
      {
        name: 'vector-db',
        label: '向量数据库 (ChromaDB)',
        running: true,
        healthy: true,
        port: 8000,
        pid: 12346,
        uptime: 7200
      }
    ];
  } catch (err) {
    console.error('加载服务状态失败:', err);
  } finally {
    loading.value = false;
  }
}

// 模拟启动服务
async function startWorker(name: string): Promise<void> {
  operationLoading.value = name;
  try {
    // TODO: 对接实际的 API
    await new Promise(resolve => setTimeout(resolve, 1500));
    const worker = workers.value.find(w => w.name === name);
    if (worker) {
      worker.running = true;
      worker.healthy = true;
      worker.port = Math.floor(Math.random() * 1000) + 8000;
      worker.pid = Math.floor(Math.random() * 10000) + 10000;
      worker.uptime = 0;
    }
  } catch (err) {
    console.error(`启动服务 ${name} 失败:`, err);
  } finally {
    operationLoading.value = null;
  }
}

// 模拟停止服务
async function stopWorker(name: string): Promise<void> {
  operationLoading.value = name;
  try {
    // TODO: 对接实际的 API
    await new Promise(resolve => setTimeout(resolve, 1000));
    const worker = workers.value.find(w => w.name === name);
    if (worker) {
      worker.running = false;
      worker.healthy = false;
      worker.port = undefined;
      worker.pid = undefined;
      worker.uptime = undefined;
    }
  } catch (err) {
    console.error(`停止服务 ${name} 失败:`, err);
  } finally {
    operationLoading.value = null;
  }
}

function formatUptime(seconds?: number): string {
  if (seconds === undefined) return '-';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

onMounted(() => {
  loadData();
});
</script>

<template>
  <div class="h-full overflow-y-auto p-8 lg:p-12 bg-background text-foreground">
    <div class="mx-auto max-w-4xl">
      <div class="flex items-center justify-between mb-8">
        <h2 class="text-2xl font-bold tracking-tight">内置服务 (Workers)</h2>
        <button 
          @click="loadData" 
          :disabled="loading"
          class="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50 shadow-sm"
        >
          <span :class="['i-carbon-renew', loading ? 'animate-spin text-primary' : '']"></span>
          刷新状态
        </button>
      </div>

      <div v-if="loading && workers.length === 0" class="flex flex-col items-center justify-center py-24 text-muted-foreground">
        <span class="i-carbon-circle-dash mb-4 text-5xl animate-spin text-primary/70"></span>
        <p class="text-base font-medium">加载服务状态中...</p>
      </div>

      <div v-else class="grid grid-cols-1 gap-5">
        <div 
          v-for="worker in workers" 
          :key="worker.name"
          class="rounded-xl border border-border bg-card p-6 shadow-sm transition-all hover:shadow-md hover:border-primary/30"
        >
          <div class="flex items-start justify-between">
            <div class="flex items-start gap-4">
              <!-- 状态指示灯 -->
              <div class="relative flex h-4 w-4 items-center justify-center mt-1">
                <span 
                  v-if="worker.running" 
                  class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                  :class="worker.healthy ? 'bg-green-400' : 'bg-yellow-400'"
                ></span>
                <span 
                  class="relative inline-flex h-3.5 w-3.5 rounded-full shadow-sm"
                  :class="worker.running ? (worker.healthy ? 'bg-green-500' : 'bg-yellow-500') : 'bg-gray-400'"
                ></span>
              </div>
              
              <div>
                <h3 class="text-lg font-semibold tracking-tight text-foreground flex items-center gap-3">
                  {{ worker.label }}
                  <span class="text-xs font-mono font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-md border border-border/50">{{ worker.name }}</span>
                </h3>
                <div class="mt-2.5 flex flex-wrap items-center gap-5 text-sm text-muted-foreground">
                  <span v-if="worker.running" class="flex items-center gap-1.5 bg-background border border-border/50 px-2.5 py-1 rounded-md">
                    <span class="i-carbon-time text-primary/70"></span> 运行时间: <span class="font-medium text-foreground">{{ formatUptime(worker.uptime) }}</span>
                  </span>
                  <span v-if="worker.port" class="flex items-center gap-1.5 bg-background border border-border/50 px-2.5 py-1 rounded-md">
                    <span class="i-carbon-network-4 text-primary/70"></span> 端口: <span class="font-mono font-medium text-foreground">{{ worker.port }}</span>
                  </span>
                  <span v-if="worker.pid" class="flex items-center gap-1.5 bg-background border border-border/50 px-2.5 py-1 rounded-md">
                    <span class="i-carbon-chip text-primary/70"></span> PID: <span class="font-mono font-medium text-foreground">{{ worker.pid }}</span>
                  </span>
                  <span v-if="!worker.running" class="text-gray-500 font-medium flex items-center gap-1.5">
                    <span class="i-carbon-power"></span> 已停止
                  </span>
                </div>
              </div>
            </div>

            <!-- 操作按钮 -->
            <div class="flex items-center gap-3 ml-4">
              <button
                v-if="!worker.running"
                @click="startWorker(worker.name)"
                :disabled="operationLoading === worker.name"
                class="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors shadow-sm"
              >
                <span v-if="operationLoading === worker.name" class="i-carbon-circle-dash animate-spin"></span>
                <span v-else class="i-carbon-play"></span>
                启动服务
              </button>
              <button
                v-else
                @click="stopWorker(worker.name)"
                :disabled="operationLoading === worker.name"
                class="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 px-5 py-2.5 text-sm font-medium hover:bg-red-100 dark:hover:bg-red-500/20 disabled:opacity-50 transition-colors"
              >
                <span v-if="operationLoading === worker.name" class="i-carbon-circle-dash animate-spin"></span>
                <span v-else class="i-carbon-stop"></span>
                停止服务
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
