<script setup lang="ts">
/**
 * WorkersSettings - 内置 Worker 服务管理
 */

import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useGateway } from '@/composables/useGateway';
import { useMessageStore } from '@/components/Message';
import type { WorkerInfo, WorkerStatus } from '@shared/events';

interface ModelOption {
  id: string;
  label: string;
  type: 'local' | 'online';
  description: string;
  configKey: string;
  modelName?: string;
  defaultApiUrl?: string;
  lockApiUrl?: boolean;
  provider?: string;
  pricing?: string;
  requiresApiKey?: boolean;
  apiKeyLabel?: string;
  apiKeyUrl?: string;
  free?: boolean;
}

interface WorkerModelDef {
  configField: string;
  options: ModelOption[];
}

interface ModelSwitchState {
  phase: 'saving' | 'restarting' | 'loading' | 'ready' | 'error';
  message: string;
  startedAt: number;
}

interface WorkerTestResult {
  ok?: boolean;
  provider?: string;
  backend?: string;
  model_name?: string;
  latency_ms?: number;
  inference_latency_ms?: number;
  audio_bytes?: number;
  sample_seconds?: number;
  text?: string;
  message?: string;
  error?: string;
  events?: string[];
}

interface WorkerTestRpcResult {
  name: string;
  started?: boolean;
  result: WorkerTestResult;
}

const { request, on, onConnect } = useGateway();
const message = useMessageStore();

const workers = ref<WorkerInfo[]>([]);
const selectedWorkerName = ref('');
const loading = ref(true);
const error = ref<string | null>(null);
const operationLoading = ref<string | null>(null);
const lastUpdatedAt = ref<number | null>(null);

const workerModels = ref<Record<string, WorkerModelDef>>({});
const workerConfigs = ref<Record<string, Record<string, unknown>>>({});
const configSaving = ref<string | null>(null);
const modelSwitching = ref<Record<string, ModelSwitchState>>({});
const pollingTimers = ref<Record<string, ReturnType<typeof setTimeout>>>({});

const apiKeyInputs = ref<Record<string, string>>({});
const apiUrlInputs = ref<Record<string, string>>({});
const apiKeyVisible = ref<Record<string, boolean>>({});
const workerTesting = ref<Record<string, boolean>>({});
const workerTestResults = ref<Record<string, WorkerTestResult | undefined>>({});

const sortedWorkers = computed(() => {
  return [...workers.value].sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
});

const selectedWorker = computed(() => {
  return workers.value.find((worker) => worker.name === selectedWorkerName.value) ?? null;
});

const readyCount = computed(() => workers.value.filter((worker) => worker.status === 'ready').length);
const runningCount = computed(() => workers.value.filter((worker) => isRunningStatus(worker.status)).length);

const selectedModelDef = computed(() => {
  const worker = selectedWorker.value;
  return worker ? workerModels.value[worker.name] : undefined;
});

const selectedModelOption = computed(() => {
  const worker = selectedWorker.value;
  return worker ? getSelectedModelOption(worker.name) : undefined;
});

const localModelOptions = computed(
  () => selectedModelDef.value?.options.filter((option) => option.type === 'local') ?? []
);
const onlineModelOptions = computed(
  () => selectedModelDef.value?.options.filter((option) => option.type === 'online') ?? []
);
const selectedNeedsApiKey = computed(() => selectedModelOption.value?.requiresApiKey === true);

function isRunningStatus(status: WorkerStatus): boolean {
  return status === 'initializing' || status === 'starting' || status === 'ready' || status === 'stopping';
}

function canStart(worker: WorkerInfo): boolean {
  return worker.status === 'stopped' || worker.status === 'error';
}

function canStop(worker: WorkerInfo): boolean {
  return worker.status === 'initializing' || worker.status === 'starting' || worker.status === 'ready';
}

function isTestableWorker(name: string): boolean {
  return name === 'asr' || name === 'tts' || name === 'ocr';
}

function canTestWorker(worker: WorkerInfo): boolean {
  return (
    isTestableWorker(worker.name) &&
    !workerTesting.value[worker.name] &&
    !modelSwitching.value[worker.name] &&
    !hasUnsavedApiConfig(worker.name) &&
    worker.status !== 'stopping'
  );
}

function statusMeta(status: WorkerStatus): {
  label: string;
  icon: string;
  dotClass: string;
  badgeClass: string;
  textClass: string;
  description: string;
} {
  switch (status) {
    case 'ready':
      return {
        label: '已就绪',
        icon: 'i-carbon-checkmark-filled',
        dotClass: 'bg-success',
        badgeClass: 'bg-success/10 text-success',
        textClass: 'text-success',
        description: '服务可用，工具可以直接调用。'
      };
    case 'initializing':
      return {
        label: '初始化',
        icon: 'i-carbon-circle-dash',
        dotClass: 'bg-warning',
        badgeClass: 'bg-warning/10 text-warning',
        textClass: 'text-warning',
        description: '正在准备运行环境或安装依赖。'
      };
    case 'starting':
      return {
        label: '启动中',
        icon: 'i-carbon-circle-dash',
        dotClass: 'bg-warning',
        badgeClass: 'bg-warning/10 text-warning',
        textClass: 'text-warning',
        description: '进程已启动，正在等待健康检查。'
      };
    case 'stopping':
      return {
        label: '停止中',
        icon: 'i-carbon-circle-dash',
        dotClass: 'bg-muted-foreground',
        badgeClass: 'bg-muted text-muted-foreground',
        textClass: 'text-muted-foreground',
        description: '正在优雅关闭服务进程。'
      };
    case 'error':
      return {
        label: '异常',
        icon: 'i-carbon-warning-filled',
        dotClass: 'bg-error',
        badgeClass: 'bg-error/10 text-error',
        textClass: 'text-error',
        description: '服务启动或运行过程中出现错误。'
      };
    default:
      return {
        label: '已停止',
        icon: 'i-carbon-stop-filled',
        dotClass: 'bg-muted-foreground/35',
        badgeClass: 'bg-muted text-muted-foreground',
        textClass: 'text-muted-foreground',
        description: '服务按需启动，当前没有占用资源。'
      };
  }
}

function selectWorker(name: string): void {
  selectedWorkerName.value = name;
}

function closeWorkerDetail(): void {
  selectedWorkerName.value = '';
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
      return 'i-carbon-cloud-service-management';
  }
}

function upsertWorker(worker: WorkerInfo): void {
  const index = workers.value.findIndex((item) => item.name === worker.name);
  if (index >= 0) {
    workers.value[index] = { ...workers.value[index], ...worker };
  } else {
    workers.value.push(worker);
  }

  lastUpdatedAt.value = Date.now();
  syncSwitchStateFromWorker(worker);
}

function readWorkerFromEvent(payload: unknown): WorkerInfo | null {
  if (!payload || typeof payload !== 'object') return null;
  const event = payload as { worker?: WorkerInfo; name?: string; label?: string; status?: WorkerStatus };
  if (event.worker?.name) return event.worker;
  if (typeof event.name === 'string' && typeof event.label === 'string' && typeof event.status === 'string') {
    return event as WorkerInfo;
  }
  return null;
}

async function loadWorkers(): Promise<void> {
  loading.value = true;
  error.value = null;

  try {
    const result = await request<{ workers: WorkerInfo[] }>('worker.list', {});
    workers.value = result.workers ?? [];

    if (selectedWorkerName.value && !workers.value.some((worker) => worker.name === selectedWorkerName.value)) {
      selectedWorkerName.value = '';
    }

    await Promise.all(workers.value.map((worker) => loadWorkerModels(worker.name)));
    await Promise.all(
      workers.value.filter((worker) => workerModels.value[worker.name]).map((worker) => loadWorkerConfig(worker.name))
    );

    lastUpdatedAt.value = Date.now();
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    error.value = text;
    workers.value = [];
  } finally {
    loading.value = false;
  }
}

async function loadWorkerModels(name: string): Promise<void> {
  try {
    const result = await request<{ name: string; models: WorkerModelDef | null }>('worker.modelsGet', { name });
    if (result.models) {
      workerModels.value[name] = result.models;
    }
  } catch (err) {
    console.warn(`[WorkersSettings] Failed to load models for ${name}:`, err);
  }
}

async function loadWorkerConfig(name: string): Promise<void> {
  try {
    const result = await request<{ name: string; config: Record<string, unknown> }>('worker.configGet', { name });
    workerConfigs.value[name] = result.config ?? {};
    syncApiInputsFromConfig(name, workerConfigs.value[name]);
  } catch (err) {
    console.warn(`[WorkersSettings] Failed to load config for ${name}:`, err);
    workerConfigs.value[name] = {};
    apiKeyInputs.value[name] = '';
    apiUrlInputs.value[name] = '';
  }
}

function syncApiInputsFromConfig(name: string, config: Record<string, unknown>): void {
  apiKeyInputs.value[name] = typeof config.api_key === 'string' ? config.api_key : '';
  apiUrlInputs.value[name] = typeof config.api_url === 'string' ? config.api_url : '';
}

function getSelectedModel(workerName: string): string | undefined {
  const def = workerModels.value[workerName];
  const config = workerConfigs.value[workerName];
  if (!def || !config) return undefined;
  return config[def.configField] as string | undefined;
}

function getSelectedModelOption(workerName: string): ModelOption | undefined {
  const def = workerModels.value[workerName];
  if (!def) return undefined;

  const selected = getSelectedModel(workerName);
  if (!selected) return def.options[0];

  return def.options.find((option) => option.configKey === selected) ?? def.options[0];
}

function getModelName(option?: ModelOption): string {
  if (!option) return '-';
  if (option.modelName) return option.modelName;
  if (option.configKey.includes('/')) return option.configKey.split('/').pop() || option.configKey;
  return option.configKey;
}

function getApiKeyLabel(option?: ModelOption): string {
  return option?.apiKeyLabel || 'API Key';
}

function getApiEndpoint(workerName: string): string {
  const option = getSelectedModelOption(workerName);
  if (option?.defaultApiUrl) return option.defaultApiUrl;
  return apiUrlInputs.value[workerName] ?? '';
}

function getApiEndpointLabel(workerName: string): string {
  const endpoint = getApiEndpoint(workerName);
  return endpoint.startsWith('ws') ? 'WebSocket 地址' : 'API 地址';
}

function isApiUrlLocked(workerName: string): boolean {
  return getSelectedModelOption(workerName)?.lockApiUrl === true;
}

function isModelSelected(workerName: string, option: ModelOption): boolean {
  const selected = getSelectedModel(workerName);
  if (!selected) return option === workerModels.value[workerName]?.options[0];
  return selected === option.configKey;
}

function setSwitchState(name: string, phase: ModelSwitchState['phase'], text: string): void {
  modelSwitching.value[name] = {
    phase,
    message: text,
    startedAt: modelSwitching.value[name]?.startedAt ?? Date.now()
  };
}

function clearPolling(name: string): void {
  if (pollingTimers.value[name]) {
    clearTimeout(pollingTimers.value[name]);
    delete pollingTimers.value[name];
  }
}

function clearSwitchState(name: string): void {
  clearPolling(name);
  delete modelSwitching.value[name];
}

function syncSwitchStateFromWorker(worker: WorkerInfo): void {
  const state = modelSwitching.value[worker.name];
  if (!state) return;

  if (worker.status === 'ready') {
    setSwitchState(worker.name, 'ready', '配置已生效，服务已就绪');
    setTimeout(() => clearSwitchState(worker.name), 2400);
  } else if (worker.status === 'error') {
    setSwitchState(worker.name, 'error', worker.error || '服务启动失败，请检查日志');
    setTimeout(() => clearSwitchState(worker.name), 8000);
  } else if (worker.status === 'initializing' || worker.status === 'starting') {
    setSwitchState(worker.name, 'loading', statusMeta(worker.status).description);
  }
}

async function pollWorkerHealth(name: string, maxWaitMs = 300000): Promise<void> {
  const startedAt = modelSwitching.value[name]?.startedAt ?? Date.now();
  let attempt = 0;

  const poll = async (): Promise<void> => {
    if (!modelSwitching.value[name]) return;
    attempt++;

    const elapsed = Date.now() - startedAt;
    if (elapsed > maxWaitMs) {
      setSwitchState(name, 'error', '等待服务就绪超时，请检查服务日志');
      setTimeout(() => clearSwitchState(name), 8000);
      return;
    }

    try {
      const result = await request<{ workers: WorkerInfo[] }>('worker.list', {});
      for (const worker of result.workers ?? []) {
        upsertWorker(worker);
      }
    } catch {
      // 连接抖动时继续轮询
    }

    if (modelSwitching.value[name]) {
      const delay = attempt < 5 ? 2000 : attempt < 15 ? 3000 : 5000;
      pollingTimers.value[name] = setTimeout(poll, delay);
    }
  };

  pollingTimers.value[name] = setTimeout(poll, 1200);
}

async function selectModel(workerName: string, option: ModelOption): Promise<void> {
  const def = workerModels.value[workerName];
  if (!def || configSaving.value === workerName || modelSwitching.value[workerName]) return;
  if (isModelSelected(workerName, option)) return;

  configSaving.value = workerName;
  setSwitchState(workerName, 'saving', `正在切换到 ${option.label}`);

  try {
    const result = await request<{ name: string; config: Record<string, unknown>; restarted?: boolean }>(
      'worker.configUpdate',
      {
        name: workerName,
        config: {
          [def.configField]: option.configKey,
          ...(option.lockApiUrl && option.defaultApiUrl ? { api_url: option.defaultApiUrl } : {})
        }
      }
    );

    workerConfigs.value[workerName] = result.config ?? {
      ...(workerConfigs.value[workerName] ?? {}),
      [def.configField]: option.configKey
    };
    syncApiInputsFromConfig(workerName, workerConfigs.value[workerName]);

    if (result.restarted) {
      setSwitchState(workerName, 'restarting', '配置已保存，服务正在重启');
      void pollWorkerHealth(workerName);
    } else {
      setSwitchState(workerName, 'ready', '配置已保存');
      setTimeout(() => clearSwitchState(workerName), 1800);
    }

    message.success('模型配置已保存');
  } catch (err) {
    const text = err instanceof Error ? err.message : '保存模型配置失败';
    setSwitchState(workerName, 'error', text);
    message.error(text);
    setTimeout(() => clearSwitchState(workerName), 6000);
  } finally {
    configSaving.value = null;
  }
}

async function saveApiConfig(workerName: string): Promise<void> {
  if (configSaving.value === workerName) return;
  configSaving.value = workerName;
  setSwitchState(workerName, 'saving', '正在保存 API 配置');
  const option = getSelectedModelOption(workerName);
  const lockedApiUrl = option?.lockApiUrl === true;

  try {
    const result = await request<{ name: string; config: Record<string, unknown>; restarted?: boolean }>(
      'worker.configUpdate',
      {
        name: workerName,
        config: {
          api_key: apiKeyInputs.value[workerName] ?? '',
          api_url: lockedApiUrl ? (option?.defaultApiUrl ?? '') : (apiUrlInputs.value[workerName] ?? '')
        }
      }
    );

    workerConfigs.value[workerName] = result.config ?? workerConfigs.value[workerName] ?? {};
    syncApiInputsFromConfig(workerName, workerConfigs.value[workerName]);

    if (result.restarted) {
      setSwitchState(workerName, 'restarting', 'API 配置已保存，服务正在重启');
      void pollWorkerHealth(workerName);
    } else {
      setSwitchState(workerName, 'ready', 'API 配置已保存');
      setTimeout(() => clearSwitchState(workerName), 1800);
    }

    message.success('API 配置已保存');
  } catch (err) {
    const text = err instanceof Error ? err.message : '保存 API 配置失败';
    setSwitchState(workerName, 'error', text);
    message.error(text);
    setTimeout(() => clearSwitchState(workerName), 6000);
  } finally {
    configSaving.value = null;
  }
}

function toggleApiKeyVisibility(workerName: string): void {
  apiKeyVisible.value[workerName] = !apiKeyVisible.value[workerName];
}

async function openApiKeyPage(workerName: string): Promise<void> {
  const option = getSelectedModelOption(workerName);
  const url = option?.apiKeyUrl;

  if (!url) {
    message.warning('当前模型没有配置 API Key 页面');
    return;
  }

  try {
    const result = await window.api?.tab?.create({
      title: `获取 ${getApiKeyLabel(option)}`,
      url,
      type: 'webpage',
      isActive: true,
      closable: true
    });

    if (result && !result.success) {
      throw new Error(result.error || '打开网页失败');
    }
  } catch (err) {
    message.error(err instanceof Error ? err.message : '打开网页失败');
  }
}

function hasUnsavedApiConfig(workerName: string): boolean {
  const saved = workerConfigs.value[workerName] ?? {};
  const savedKey = typeof saved.api_key === 'string' ? saved.api_key : '';
  const savedUrl = typeof saved.api_url === 'string' ? saved.api_url : '';
  const option = getSelectedModelOption(workerName);
  const lockedApiUrl = option?.lockApiUrl === true;

  if (lockedApiUrl) {
    return (apiKeyInputs.value[workerName] ?? '') !== savedKey;
  }

  return (apiKeyInputs.value[workerName] ?? '') !== savedKey || (apiUrlInputs.value[workerName] ?? '') !== savedUrl;
}

async function startWorker(worker: WorkerInfo): Promise<void> {
  operationLoading.value = `${worker.name}:start`;

  try {
    await request('worker.start', { name: worker.name });
    upsertWorker({ ...worker, status: 'starting' });
    message.success('已请求启动服务');
    setTimeout(() => void loadWorkers(), 800);
  } catch (err) {
    message.error(err instanceof Error ? err.message : '启动服务失败');
  } finally {
    operationLoading.value = null;
  }
}

async function stopWorker(worker: WorkerInfo): Promise<void> {
  operationLoading.value = `${worker.name}:stop`;

  try {
    await request('worker.stop', { name: worker.name });
    message.success('服务已停止');
    await loadWorkers();
  } catch (err) {
    message.error(err instanceof Error ? err.message : '停止服务失败');
  } finally {
    operationLoading.value = null;
  }
}

async function testWorker(worker: WorkerInfo): Promise<void> {
  if (!isTestableWorker(worker.name) || workerTesting.value[worker.name]) return;

  if (hasUnsavedApiConfig(worker.name)) {
    message.warning('请先保存 API 配置后再测试');
    return;
  }

  workerTesting.value[worker.name] = true;
  workerTestResults.value[worker.name] = undefined;

  try {
    const result = await request<WorkerTestRpcResult>('worker.test', { name: worker.name });
    workerTestResults.value[worker.name] = result.result;
    message.success(result.started ? '服务已启动，测试通过' : '测试通过');
    await loadWorkers();
  } catch (err) {
    const text = err instanceof Error ? err.message : '测试失败';
    workerTestResults.value[worker.name] = {
      ok: false,
      error: text
    };
    message.error(text, { duration: 5000 });
  } finally {
    workerTesting.value[worker.name] = false;
  }
}

function getTestResultTitle(result?: WorkerTestResult): string {
  if (!result) return '';
  return result.ok ? '测试通过' : '测试失败';
}

function getTestResultDetail(result?: WorkerTestResult): string {
  if (!result) return '';
  if (!result.ok) return result.error || '测试失败';

  const parts = [
    result.provider || result.backend,
    result.model_name,
    typeof result.latency_ms === 'number' ? `${result.latency_ms}ms` : undefined,
    typeof result.audio_bytes === 'number' ? `${formatBytes(result.audio_bytes)}` : undefined
  ].filter(Boolean);

  return parts.join(' · ') || result.message || '测试完成';
}

function formatUptime(seconds?: number): string {
  if (!seconds || seconds < 0) return '-';

  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}天${hours % 24}小时`;
  if (hours > 0) return `${hours}小时${minutes % 60}分钟`;
  if (minutes > 0) return `${minutes}分钟`;
  return `${Math.floor(seconds)}秒`;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes < 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatNumber(value?: number, suffix = ''): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  return `${value.toFixed(1)}${suffix}`;
}

function formatUpdatedAt(timestamp?: number | null): string {
  if (!timestamp) return '尚未同步';
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

onMounted(() => {
  on('worker:status', (payload) => {
    const worker = readWorkerFromEvent(payload);
    if (worker) upsertWorker(worker);
  });

  onConnect(() => {
    void loadWorkers();
  });

  void loadWorkers();
});

onBeforeUnmount(() => {
  Object.keys(pollingTimers.value).forEach(clearPolling);
});
</script>

<template>
  <div class="flex h-full min-w-0 flex-col bg-background text-foreground">
    <header class="border-b border-border/60 bg-surface/55 px-5 py-4 lg:px-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-3">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <span class="i-carbon-cloud-service-management h-4 w-4"></span>
          </span>
          <div class="min-w-0">
            <h2 class="truncate text-sm font-semibold">内置服务</h2>
            <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span>{{ readyCount }}/{{ workers.length }} 个已就绪</span>
              <span>运行中 {{ runningCount }}</span>
              <span>更新 {{ formatUpdatedAt(lastUpdatedAt) }}</span>
            </div>
          </div>
        </div>

        <button
          class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          :disabled="loading"
          @click="loadWorkers">
          <span class="i-carbon-renew h-3.5 w-3.5" :class="{ 'animate-spin': loading }"></span>
          刷新
        </button>
      </div>
    </header>

    <main class="min-h-0 flex-1 overflow-y-auto px-5 py-5 lg:px-6">
      <div v-if="loading" class="flex h-full min-h-60 flex-col items-center justify-center text-muted-foreground">
        <span class="i-carbon-circle-dash mb-3 inline-block h-6 w-6 animate-spin text-primary/70"></span>
        <p class="text-xs font-medium">加载中...</p>
      </div>

      <div
        v-else-if="error"
        class="mx-auto max-w-lg rounded-lg border border-error/20 bg-error/10 p-4 text-center text-xs text-error">
        {{ error }}
        <button
          class="mt-3 inline-flex h-8 items-center justify-center rounded-lg bg-error/10 px-3 font-medium transition-colors hover:bg-error/15"
          type="button"
          @click="loadWorkers">
          重试
        </button>
      </div>

      <div
        v-else-if="sortedWorkers.length === 0"
        class="flex h-full min-h-60 items-center justify-center text-center text-xs text-muted-foreground">
        暂无可用内置服务
      </div>

      <div v-else class="mx-auto grid max-w-5xl gap-3">
        <article
          v-for="worker in sortedWorkers"
          :key="worker.name"
          class="rounded-lg border border-border bg-card transition-colors hover:border-primary/35">
          <div class="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between">
            <button
              class="flex min-w-0 flex-1 items-start gap-3 text-left"
              type="button"
              @click="selectWorker(worker.name)">
              <span
                class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <span :class="[workerIcon(worker.name), 'h-4 w-4']"></span>
              </span>

              <span class="min-w-0 flex-1">
                <span class="flex flex-wrap items-center gap-2">
                  <span class="truncate text-sm font-semibold text-foreground">{{ worker.label }}</span>
                  <span
                    class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium"
                    :class="statusMeta(worker.status).badgeClass">
                    <span
                      :class="[
                        statusMeta(worker.status).icon,
                        'h-3 w-3',
                        {
                          'animate-spin':
                            worker.status === 'initializing' ||
                            worker.status === 'starting' ||
                            worker.status === 'stopping'
                        }
                      ]"></span>
                    {{ statusMeta(worker.status).label }}
                  </span>
                </span>

                <span class="mt-1 block truncate font-mono text-[11px] text-muted-foreground">{{ worker.name }}</span>

                <span class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  <span>端口 {{ worker.port ?? '-' }}</span>
                  <span>PID {{ worker.pid ?? '-' }}</span>
                  <span>运行 {{ formatUptime(worker.metrics?.uptimeSeconds) }}</span>
                  <span v-if="worker.error" class="text-error">异常信息</span>
                </span>
              </span>
            </button>

            <div class="flex shrink-0 items-center justify-end gap-2 md:self-center">
              <button
                v-if="canStart(worker)"
                class="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                :disabled="operationLoading === `${worker.name}:start`"
                @click="startWorker(worker)">
                <span
                  v-if="operationLoading === `${worker.name}:start`"
                  class="i-carbon-circle-dash h-3.5 w-3.5 animate-spin"></span>
                <span v-else class="i-carbon-play h-3.5 w-3.5"></span>
                启动
              </button>
              <button
                v-else
                class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-error/30 bg-error/10 px-3 text-xs font-medium text-error transition-colors hover:bg-error/15 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                :disabled="!canStop(worker) || operationLoading === `${worker.name}:stop`"
                @click="stopWorker(worker)">
                <span
                  v-if="operationLoading === `${worker.name}:stop`"
                  class="i-carbon-circle-dash h-3.5 w-3.5 animate-spin"></span>
                <span v-else class="i-carbon-stop h-3.5 w-3.5"></span>
                停止
              </button>

              <button
                class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-muted"
                type="button"
                @click="selectWorker(worker.name)">
                <span class="i-carbon-settings-adjust h-3.5 w-3.5"></span>
                详情
              </button>
            </div>
          </div>
        </article>
      </div>
    </main>

    <div
      v-if="selectedWorker"
      class="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      @click.self="closeWorkerDetail">
      <section
        class="flex max-h-[calc(100vh-3rem)] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl">
        <header class="flex shrink-0 items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
          <div class="flex min-w-0 items-start gap-3">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <span :class="[workerIcon(selectedWorker.name), 'h-4 w-4']"></span>
            </span>
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <h1 class="truncate text-base font-semibold text-foreground">{{ selectedWorker.label }}</h1>
                <span
                  class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium"
                  :class="statusMeta(selectedWorker.status).badgeClass">
                  <span
                    :class="[
                      statusMeta(selectedWorker.status).icon,
                      'h-3 w-3',
                      {
                        'animate-spin':
                          selectedWorker.status === 'initializing' ||
                          selectedWorker.status === 'starting' ||
                          selectedWorker.status === 'stopping'
                      }
                    ]"></span>
                  {{ statusMeta(selectedWorker.status).label }}
                </span>
              </div>
              <p class="mt-1 text-xs leading-5 text-muted-foreground">
                {{ statusMeta(selectedWorker.status).description }}
              </p>
              <p class="mt-1 font-mono text-[11px] text-muted-foreground">{{ selectedWorker.name }}</p>
            </div>
          </div>

          <button
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            type="button"
            title="关闭"
            @click="closeWorkerDetail">
            <span class="i-carbon-close h-4 w-4"></span>
          </button>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div class="mb-4 flex flex-wrap justify-end gap-2">
            <button
              class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              :disabled="loading"
              @click="loadWorkers">
              <span class="i-carbon-renew h-3.5 w-3.5" :class="{ 'animate-spin': loading }"></span>
              刷新
            </button>
            <button
              v-if="isTestableWorker(selectedWorker.name)"
              class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary/35 bg-primary/10 px-3 text-xs font-medium text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              :disabled="!canTestWorker(selectedWorker)"
              :title="hasUnsavedApiConfig(selectedWorker.name) ? '请先保存 API 配置' : '实际调用服务进行测试'"
              @click="testWorker(selectedWorker)">
              <span
                v-if="workerTesting[selectedWorker.name]"
                class="i-carbon-circle-dash h-3.5 w-3.5 animate-spin"></span>
              <span v-else class="i-carbon-connection-signal h-3.5 w-3.5"></span>
              测试
            </button>
            <button
              v-if="canStart(selectedWorker)"
              class="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              :disabled="operationLoading === `${selectedWorker.name}:start`"
              @click="startWorker(selectedWorker)">
              <span
                v-if="operationLoading === `${selectedWorker.name}:start`"
                class="i-carbon-circle-dash h-3.5 w-3.5 animate-spin"></span>
              <span v-else class="i-carbon-play h-3.5 w-3.5"></span>
              启动
            </button>
            <button
              v-else
              class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-error/30 bg-error/10 px-3 text-xs font-medium text-error transition-colors hover:bg-error/15 disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              :disabled="!canStop(selectedWorker) || operationLoading === `${selectedWorker.name}:stop`"
              @click="stopWorker(selectedWorker)">
              <span
                v-if="operationLoading === `${selectedWorker.name}:stop`"
                class="i-carbon-circle-dash h-3.5 w-3.5 animate-spin"></span>
              <span v-else class="i-carbon-stop h-3.5 w-3.5"></span>
              停止
            </button>
          </div>

          <div class="grid gap-4">
            <section class="rounded-lg border border-border bg-card">
              <div class="border-b border-border/60 px-4 py-3">
                <h3 class="text-sm font-semibold text-foreground">运行状态</h3>
              </div>

              <div class="grid gap-px bg-border/60 sm:grid-cols-2 lg:grid-cols-4">
                <div class="bg-card px-4 py-3">
                  <p class="text-[11px] font-medium text-muted-foreground">端口</p>
                  <p class="mt-1 font-mono text-sm font-semibold">{{ selectedWorker.port ?? '-' }}</p>
                </div>
                <div class="bg-card px-4 py-3">
                  <p class="text-[11px] font-medium text-muted-foreground">PID</p>
                  <p class="mt-1 font-mono text-sm font-semibold">{{ selectedWorker.pid ?? '-' }}</p>
                </div>
                <div class="bg-card px-4 py-3">
                  <p class="text-[11px] font-medium text-muted-foreground">运行时长</p>
                  <p class="mt-1 text-sm font-semibold">{{ formatUptime(selectedWorker.metrics?.uptimeSeconds) }}</p>
                </div>
                <div class="bg-card px-4 py-3">
                  <p class="text-[11px] font-medium text-muted-foreground">重启次数</p>
                  <p class="mt-1 text-sm font-semibold">{{ selectedWorker.restartCount }}</p>
                </div>
                <div class="bg-card px-4 py-3">
                  <p class="text-[11px] font-medium text-muted-foreground">CPU</p>
                  <p class="mt-1 text-sm font-semibold">{{ formatNumber(selectedWorker.metrics?.cpuPercent, '%') }}</p>
                </div>
                <div class="bg-card px-4 py-3">
                  <p class="text-[11px] font-medium text-muted-foreground">内存</p>
                  <p class="mt-1 text-sm font-semibold">{{ formatBytes(selectedWorker.metrics?.memoryBytes) }}</p>
                </div>
                <div class="bg-card px-4 py-3">
                  <p class="text-[11px] font-medium text-muted-foreground">内存占比</p>
                  <p class="mt-1 text-sm font-semibold">{{
                    formatNumber(selectedWorker.metrics?.memoryPercent, '%')
                  }}</p>
                </div>
                <div class="bg-card px-4 py-3">
                  <p class="text-[11px] font-medium text-muted-foreground">健康检查</p>
                  <p class="mt-1 text-sm font-semibold">
                    {{ formatNumber(selectedWorker.metrics?.healthCheckLatency, 'ms') }}
                  </p>
                </div>
              </div>
            </section>

            <section class="rounded-lg border border-border bg-card">
              <div class="border-b border-border/60 px-4 py-3">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <h3 class="text-sm font-semibold text-foreground">模型配置</h3>
                  <span
                    v-if="selectedModelOption"
                    class="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
                    <span class="i-carbon-machine-learning-model h-3.5 w-3.5"></span>
                    {{ selectedModelOption.label }}
                  </span>
                </div>
              </div>

              <div v-if="!selectedModelDef" class="px-4 py-8 text-center text-xs text-muted-foreground">
                这个服务暂未提供可视化模型配置。
              </div>

              <div v-else class="grid gap-5 px-4 py-4">
                <div v-if="localModelOptions.length > 0">
                  <div class="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                    本地模型
                  </div>
                  <div class="grid gap-2">
                    <button
                      v-for="option in localModelOptions"
                      :key="option.id"
                      class="flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                      :class="
                        isModelSelected(selectedWorker.name, option)
                          ? 'border-primary/45 bg-primary/5'
                          : 'border-border bg-background hover:border-primary/35 hover:bg-muted/40'
                      "
                      type="button"
                      :disabled="!!modelSwitching[selectedWorker.name]"
                      @click="selectModel(selectedWorker.name, option)">
                      <span
                        class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
                        :class="
                          isModelSelected(selectedWorker.name, option)
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-muted-foreground/35'
                        ">
                        <span
                          v-if="isModelSelected(selectedWorker.name, option)"
                          class="i-carbon-checkmark h-3 w-3"></span>
                      </span>
                      <span class="min-w-0 flex-1">
                        <span class="flex flex-wrap items-center gap-1.5">
                          <span class="text-sm font-medium text-foreground">{{ option.label }}</span>
                          <span class="rounded bg-success/10 px-1.5 py-0.5 text-[10px] text-success">本地</span>
                          <span v-if="option.provider" class="text-[11px] text-muted-foreground">
                            {{ option.provider }}
                          </span>
                        </span>
                        <span class="mt-1 block text-xs leading-5 text-muted-foreground">{{ option.description }}</span>
                        <span class="mt-1 block font-mono text-[11px] text-muted-foreground/80">
                          {{ getModelName(option) }}
                        </span>
                      </span>
                    </button>
                  </div>
                </div>

                <div v-if="onlineModelOptions.length > 0">
                  <div class="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                    在线模型
                  </div>
                  <div class="grid gap-2">
                    <button
                      v-for="option in onlineModelOptions"
                      :key="option.id"
                      class="flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                      :class="
                        isModelSelected(selectedWorker.name, option)
                          ? 'border-primary/45 bg-primary/5'
                          : 'border-border bg-background hover:border-primary/35 hover:bg-muted/40'
                      "
                      type="button"
                      :disabled="!!modelSwitching[selectedWorker.name]"
                      @click="selectModel(selectedWorker.name, option)">
                      <span
                        class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
                        :class="
                          isModelSelected(selectedWorker.name, option)
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-muted-foreground/35'
                        ">
                        <span
                          v-if="isModelSelected(selectedWorker.name, option)"
                          class="i-carbon-checkmark h-3 w-3"></span>
                      </span>
                      <span class="min-w-0 flex-1">
                        <span class="flex flex-wrap items-center gap-1.5">
                          <span class="text-sm font-medium text-foreground">{{ option.label }}</span>
                          <span class="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">在线</span>
                          <span v-if="option.free" class="rounded bg-success/10 px-1.5 py-0.5 text-[10px] text-success">
                            免费
                          </span>
                          <span v-if="option.pricing" class="text-[11px] text-warning">{{ option.pricing }}</span>
                          <span v-if="option.provider" class="text-[11px] text-muted-foreground">
                            {{ option.provider }}
                          </span>
                        </span>
                        <span class="mt-1 block text-xs leading-5 text-muted-foreground">{{ option.description }}</span>
                        <span class="mt-1 block font-mono text-[11px] text-muted-foreground/80">
                          {{ getModelName(option) }}
                        </span>
                      </span>
                    </button>
                  </div>
                </div>

                <div v-if="selectedNeedsApiKey" class="rounded-lg border border-border bg-background px-4 py-4">
                  <div class="mb-3 flex items-center justify-between gap-3">
                    <div class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <span class="i-carbon-key h-3.5 w-3.5"></span>
                      API 配置
                    </div>
                    <button
                      v-if="selectedModelOption?.apiKeyUrl"
                      class="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/45 hover:text-primary"
                      type="button"
                      title="打开 API Key 页面"
                      @click="openApiKeyPage(selectedWorker.name)">
                      <span class="i-carbon-arrow-up-right h-3 w-3"></span>
                      获取
                    </button>
                  </div>

                  <div class="grid gap-3">
                    <div class="grid gap-1.5">
                      <span class="text-[11px] font-medium text-muted-foreground">模型名称</span>
                      <div
                        class="flex h-9 min-w-0 items-center rounded-lg border border-border bg-muted px-3 font-mono text-xs text-foreground">
                        <span class="truncate">{{ getModelName(selectedModelOption) }}</span>
                      </div>
                    </div>

                    <label class="grid gap-1.5">
                      <span class="text-[11px] font-medium text-muted-foreground">
                        {{ getApiKeyLabel(selectedModelOption) }}
                      </span>
                      <span class="relative">
                        <input
                          v-model="apiKeyInputs[selectedWorker.name]"
                          :type="apiKeyVisible[selectedWorker.name] ? 'text' : 'password'"
                          class="h-9 w-full rounded-lg border border-border bg-card px-3 pr-9 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/60"
                          placeholder="输入 API Key" />
                        <button
                          class="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          type="button"
                          title="显示或隐藏 API Key"
                          @click="toggleApiKeyVisibility(selectedWorker.name)">
                          <span
                            :class="[
                              apiKeyVisible[selectedWorker.name] ? 'i-carbon-view-off' : 'i-carbon-view',
                              'h-3.5 w-3.5'
                            ]"></span>
                        </button>
                      </span>
                    </label>

                    <label v-if="!isApiUrlLocked(selectedWorker.name)" class="grid gap-1.5">
                      <span class="text-[11px] font-medium text-muted-foreground">API 地址</span>
                      <input
                        v-model="apiUrlInputs[selectedWorker.name]"
                        type="text"
                        class="h-9 w-full rounded-lg border border-border bg-card px-3 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/60"
                        placeholder="留空使用默认地址" />
                    </label>

                    <div v-else class="grid gap-1.5">
                      <span class="text-[11px] font-medium text-muted-foreground">
                        {{ getApiEndpointLabel(selectedWorker.name) }}
                      </span>
                      <div
                        class="flex h-9 min-w-0 items-center rounded-lg border border-border bg-muted px-3 font-mono text-xs text-muted-foreground">
                        <span class="truncate">{{ getApiEndpoint(selectedWorker.name) }}</span>
                      </div>
                    </div>

                    <div class="flex items-center justify-end gap-2">
                      <span v-if="hasUnsavedApiConfig(selectedWorker.name)" class="text-[11px] text-warning">
                        有未保存修改
                      </span>
                      <button
                        class="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                        type="button"
                        :disabled="configSaving === selectedWorker.name || !hasUnsavedApiConfig(selectedWorker.name)"
                        @click="saveApiConfig(selectedWorker.name)">
                        <span
                          v-if="configSaving === selectedWorker.name"
                          class="i-carbon-circle-dash h-3.5 w-3.5 animate-spin"></span>
                        <span v-else class="i-carbon-save h-3.5 w-3.5"></span>
                        保存
                      </button>
                    </div>
                  </div>
                </div>

                <div
                  v-if="modelSwitching[selectedWorker.name]"
                  class="flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs"
                  :class="{
                    'bg-primary/10 text-primary':
                      modelSwitching[selectedWorker.name].phase === 'saving' ||
                      modelSwitching[selectedWorker.name].phase === 'restarting' ||
                      modelSwitching[selectedWorker.name].phase === 'loading',
                    'bg-success/10 text-success': modelSwitching[selectedWorker.name].phase === 'ready',
                    'bg-error/10 text-error': modelSwitching[selectedWorker.name].phase === 'error'
                  }">
                  <span
                    v-if="
                      modelSwitching[selectedWorker.name].phase !== 'ready' &&
                      modelSwitching[selectedWorker.name].phase !== 'error'
                    "
                    class="i-carbon-circle-dash h-3.5 w-3.5 shrink-0 animate-spin"></span>
                  <span
                    v-else-if="modelSwitching[selectedWorker.name].phase === 'ready'"
                    class="i-carbon-checkmark-filled h-3.5 w-3.5 shrink-0"></span>
                  <span v-else class="i-carbon-warning-filled h-3.5 w-3.5 shrink-0"></span>
                  <span>{{ modelSwitching[selectedWorker.name].message }}</span>
                </div>

                <div
                  v-if="workerTestResults[selectedWorker.name]"
                  class="rounded-lg border px-3 py-3 text-xs"
                  :class="
                    workerTestResults[selectedWorker.name]?.ok
                      ? 'border-success/25 bg-success/10 text-success'
                      : 'border-error/25 bg-error/10 text-error'
                  ">
                  <div class="flex items-start gap-2">
                    <span
                      :class="[
                        workerTestResults[selectedWorker.name]?.ok
                          ? 'i-carbon-checkmark-filled'
                          : 'i-carbon-warning-filled',
                        'mt-0.5 h-3.5 w-3.5 shrink-0'
                      ]"></span>
                    <div class="min-w-0">
                      <div class="font-medium">{{ getTestResultTitle(workerTestResults[selectedWorker.name]) }}</div>
                      <div class="mt-1 break-words text-[11px] opacity-90">
                        {{ getTestResultDetail(workerTestResults[selectedWorker.name]) }}
                      </div>
                      <div
                        v-if="workerTestResults[selectedWorker.name]?.events?.length"
                        class="mt-1 truncate font-mono text-[10px] opacity-75">
                        {{ workerTestResults[selectedWorker.name]?.events?.join(' → ') }}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section v-if="selectedWorker.error" class="rounded-lg border border-error/20 bg-error/10 px-4 py-4">
              <div class="flex items-start gap-3">
                <span class="i-carbon-warning-filled mt-0.5 h-4 w-4 shrink-0 text-error"></span>
                <div class="min-w-0">
                  <h3 class="text-sm font-semibold text-error">错误信息</h3>
                  <p class="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-error/90">
                    {{ selectedWorker.error }}
                  </p>
                </div>
              </div>
            </section>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
