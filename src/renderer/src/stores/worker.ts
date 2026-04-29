/**
 * Worker Store
 *
 * 前端 Worker 状态的轻量入口：接收 Gateway 状态推送，并提供启停/刷新动作。
 */

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { gateway } from '@/plugins/gatewaySetup';
import { GatewayEventTypes, type WorkerInfo } from '@shared/events';

export const useWorkerStore = defineStore('worker', () => {
  const workers = ref<Map<string, WorkerInfo>>(new Map());
  const loading = ref(false);
  const lastError = ref<string | null>(null);
  const lastUpdatedAt = ref<number | null>(null);

  function upsertWorker(worker: WorkerInfo): void {
    workers.value.set(worker.name, worker);
    workers.value = new Map(workers.value);
    lastUpdatedAt.value = Date.now();
  }

  gateway.on(GatewayEventTypes.WORKER_STATUS, (payload) => {
    if (payload.worker) {
      upsertWorker(payload.worker);
    }
  });

  const workerList = computed(() => {
    return Array.from(workers.value.values()).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
  });

  const readyCount = computed(() => workerList.value.filter((worker) => worker.status === 'ready').length);
  const runningCount = computed(
    () =>
      workerList.value.filter((worker) => ['initializing', 'starting', 'ready', 'stopping'].includes(worker.status))
        .length
  );

  function getWorker(name: string): WorkerInfo | undefined {
    return workers.value.get(name);
  }

  function isReady(name: string): boolean {
    return workers.value.get(name)?.status === 'ready';
  }

  const ttsReady = computed(() => isReady('tts'));
  const asrReady = computed(() => isReady('asr'));
  const ocrReady = computed(() => isReady('ocr'));
  const ttsPort = computed(() => workers.value.get('tts')?.port);
  const asrPort = computed(() => workers.value.get('asr')?.port);
  const ocrPort = computed(() => workers.value.get('ocr')?.port);
  const asrWorkerName = computed(() => 'asr');
  const asrWorkerType = computed(() => 'websocket' as const);

  async function requestWorkers(): Promise<void> {
    loading.value = true;
    lastError.value = null;

    try {
      const result = await gateway.request<{ workers: WorkerInfo[] }>('worker.list', {});
      workers.value = new Map((result.workers ?? []).map((worker) => [worker.name, worker]));
      lastUpdatedAt.value = Date.now();
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error);
      console.warn('[workerStore] Failed to request workers:', error);
    } finally {
      loading.value = false;
    }
  }

  async function startWorker(name: string): Promise<void> {
    const worker = workers.value.get(name);
    if (worker) {
      upsertWorker({ ...worker, status: 'starting' });
    }

    try {
      await gateway.request('worker.start', { name });
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error);
      if (worker) upsertWorker(worker);
      console.warn(`[workerStore] Failed to start worker ${name}:`, error);
    }
  }

  async function stopWorker(name: string): Promise<void> {
    const worker = workers.value.get(name);
    if (worker) {
      upsertWorker({ ...worker, status: 'stopping' });
    }

    try {
      await gateway.request('worker.stop', { name });
      await requestWorkers();
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error);
      if (worker) upsertWorker(worker);
      console.warn(`[workerStore] Failed to stop worker ${name}:`, error);
    }
  }

  return {
    workers,
    workerList,
    loading,
    lastError,
    lastUpdatedAt,
    readyCount,
    runningCount,
    ttsReady,
    asrReady,
    ocrReady,
    ttsPort,
    asrPort,
    ocrPort,
    asrWorkerName,
    asrWorkerType,
    getWorker,
    isReady,
    requestWorkers,
    startWorker,
    stopWorker
  };
});
