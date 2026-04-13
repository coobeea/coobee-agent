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
  <div class="h-full overflow-y-auto p-6 lg:p-10 bg-background text-foreground">
    <div class="mx-auto max-w-4xl">
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-xl font-bold">内置服务 (Workers)</h2>
        <button 
          @click="loadData" 
          :disabled="loading"
          class="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-muted transition-colors disabled:opacity-50"
        >
          <span :class="['i-carbon-renew', loading ? 'animate-spin' : '']"></span>
          刷新状态
        </button>
      </div>

      <div v-if="loading && workers.length === 0" class="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <span class="i-carbon-circle-dash mb-4 text-4xl animate-spin"></span>
        <p>加载服务状态中...</p>
      </div>

      <div v-else class="grid grid-cols-1 gap-4">
        <div 
          v-for="worker in workers" 
          :key="worker.name"
          class="rounded-lg border border-border bg-card p-5 shadow-sm transition-all hover:shadow-md"
        >
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-3">
              <!-- 状态指示灯 -->
              <div class="relative flex h-3 w-3 items-center justify-center">
                <span 
                  v-if="worker.running" 
                  class="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"
                ></span>
                <span 
                  class="relative inline-flex h-3 w-3 rounded-full"
                  :class="worker.running ? (worker.healthy ? 'bg-green-500' : 'bg-yellow-500') : 'bg-gray-400'"
                ></span>
              </div>
              
              <div>
                <h3 class="text-base font-semibold text-foreground flex items-center gap-2">
                  {{ worker.label }}
                  <span class="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{{ worker.name }}</span>
                </h3>
                <div class="mt-1 flex items-center gap-4 text-xs text-muted-foreground">
                  <span v-if="worker.running" class="flex items-center gap-1">
                    <span class="i-carbon-time"></span> 运行时间: {{ formatUptime(worker.uptime) }}
                  </span>
                  <span v-if="worker.port" class="flex items-center gap-1">
                    <span class="i-carbon-network-4"></span> 端口: {{ worker.port }}
                  </span>
                  <span v-if="worker.pid" class="flex items-center gap-1">
                    <span class="i-carbon-chip"></span> PID: {{ worker.pid }}
                  </span>
                  <span v-if="!worker.running" class="text-gray-500">已停止</span>
                </div>
              </div>
            </div>

            <!-- 操作按钮 -->
            <div class="flex items-center gap-2">
              <button
                v-if="!worker.running"
                @click="startWorker(worker.name)"
                :disabled="operationLoading === worker.name"
                class="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                <span v-if="operationLoading === worker.name" class="i-carbon-circle-dash animate-spin"></span>
                <span v-else class="i-carbon-play"></span>
                启动
              </button>
              <button
                v-else
                @click="stopWorker(worker.name)"
                :disabled="operationLoading === worker.name"
                class="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 text-red-600 px-3 py-1.5 text-sm font-medium hover:bg-red-100 disabled:opacity-50 transition-colors"
              >
                <span v-if="operationLoading === worker.name" class="i-carbon-circle-dash animate-spin"></span>
                <span v-else class="i-carbon-stop"></span>
                停止
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
