<script setup lang="ts">
/**
 * ProviderSettings - 模型供应商管理
 *
 * 左右分栏：
 * - 左侧：供应商列表（含启用状态）
 * - 右侧：供应商配置详情（API Key / Base URL / 启用开关）
 */

import { ref, computed, onMounted } from 'vue';
import { useMessageStore } from '@/components/Message';
import { getProviders, saveProviderKey, updateProviderBaseUrl, toggleProvider, testProvider } from '@/api/config';
import type { ProviderConfig } from '@shared/api/config-types';

const message = useMessageStore();

const providers = ref<ProviderConfig[]>([]);
const selectedProviderId = ref<string>('');
const providerQuery = ref('');

const loading = ref(true);
const error = ref<string | null>(null);

const saving = ref(false);
const saveStatus = ref<'idle' | 'success' | 'error'>('idle');

// 当前选中的提供商的表单数据
const config = ref({
  apiKey: '',
  baseUrl: '',
  enabled: false
});

const testing = ref(false);
const testStatus = ref<'idle' | 'success' | 'error'>('idle');
const testErrorMsg = ref('');

// ==================== 计算属性 ====================

const sortedProviders = computed(() => {
  return [...providers.value].sort((a, b) => {
    // 启用的在前
    if (a.enabled !== b.enabled) {
      return a.enabled ? -1 : 1;
    }
    // 名称排序
    return a.name.localeCompare(b.name, 'zh-CN');
  });
});

const filteredProviders = computed(() => {
  const query = providerQuery.value.trim().toLowerCase();
  if (!query) return sortedProviders.value;

  return sortedProviders.value.filter((provider) => {
    const providerText = `${provider.id} ${provider.name} ${provider.description || ''}`.toLowerCase();
    return providerText.includes(query);
  });
});

const enabledProviderCount = computed(() => providers.value.filter((provider) => provider.enabled).length);
const configuredProviderCount = computed(() => providers.value.filter((provider) => provider._hasApiKey).length);

// ==================== 数据加载 ====================

async function loadData(): Promise<void> {
  loading.value = true;
  error.value = null;

  try {
    const result = await getProviders();

    if (result.success && result.data) {
      // 将对象转换为数组并排序
      const providersList = Object.values(result.data.providers);
      providers.value = providersList;

      const nextProviderId = providers.value.some((provider) => provider.id === selectedProviderId.value)
        ? selectedProviderId.value
        : sortedProviders.value[0]?.id;

      if (nextProviderId) {
        selectProvider(nextProviderId);
      }
    } else {
      error.value = result.error || '加载配置失败';
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

const selectedProviderInfo = computed(() => {
  return providers.value.find((p) => p.id === selectedProviderId.value);
});

const selectedProviderModelCount = computed(() => selectedProviderInfo.value?.models.length ?? 0);

// ==================== 交互方法 ====================

function selectProvider(id: string): void {
  selectedProviderId.value = id;
  const provider = providers.value.find((p) => p.id === id);

  if (provider) {
    config.value = {
      // API Key 是敏感信息，后端返回的是脱敏的，所以这里清空，让用户重新输入
      // 如果 provider._hasApiKey 为 true，前端可以显示占位符
      apiKey: '',
      baseUrl: provider.baseUrl || '',
      enabled: provider.enabled
    };
  }

  // 重置状态
  testStatus.value = 'idle';
  testErrorMsg.value = '';
  saveStatus.value = 'idle';
}

async function handleSave(): Promise<void> {
  if (!selectedProviderId.value) return;

  saving.value = true;
  saveStatus.value = 'idle';

  try {
    const providerId = selectedProviderId.value;

    // 1. 保存 API Key (如果用户输入了新值)
    if (config.value.apiKey) {
      const keyResult = await saveProviderKey(providerId, config.value.apiKey);
      if (!keyResult.success) throw new Error(keyResult.error || '保存 API Key 失败');
    }

    // 2. 保存 Base URL
    const urlResult = await updateProviderBaseUrl(providerId, config.value.baseUrl);
    if (!urlResult.success) throw new Error(urlResult.error || '保存 Base URL 失败');

    // 3. 保存启用状态
    const toggleResult = await toggleProvider(providerId, config.value.enabled);
    if (!toggleResult.success) throw new Error(toggleResult.error || '保存启用状态失败');

    saveStatus.value = 'success';
    message.success('配置保存成功');

    // 重新加载数据以更新列表状态
    await loadData();

    // 恢复状态提示
    setTimeout(() => {
      saveStatus.value = 'idle';
    }, 2000);
  } catch (err) {
    saveStatus.value = 'error';
    console.error('保存配置失败:', err);
    message.error(err instanceof Error ? err.message : '保存配置失败');
  } finally {
    saving.value = false;
  }
}

async function handleToggleEnabled(): Promise<void> {
  if (!selectedProviderId.value) return;

  // 乐观更新 UI
  config.value.enabled = !config.value.enabled;

  try {
    const result = await toggleProvider(selectedProviderId.value, config.value.enabled);

    if (result.success) {
      // 更新本地列表数据
      const provider = providers.value.find((p) => p.id === selectedProviderId.value);
      if (provider) {
        provider.enabled = config.value.enabled;
      }
      message.success(config.value.enabled ? '已启用服务' : '已禁用服务');
    } else {
      // 失败则回滚
      config.value.enabled = !config.value.enabled;
      console.error('切换启用状态失败:', result.error);
      message.error(result.error || '切换启用状态失败');
    }
  } catch (err) {
    // 失败则回滚
    config.value.enabled = !config.value.enabled;
    console.error('切换启用状态失败:', err);
    message.error('切换启用状态失败');
  }
}

async function handleTestConnection(): Promise<void> {
  if (!selectedProviderId.value) return;

  testing.value = true;
  testStatus.value = 'idle';
  testErrorMsg.value = '';

  try {
    const result = await testProvider(selectedProviderId.value);

    if (result.success) {
      testStatus.value = 'success';
      message.success('连接测试成功');
    } else {
      testStatus.value = 'error';
      testErrorMsg.value = result.error || '连接测试失败';
      message.error(testErrorMsg.value);
    }
  } catch (err) {
    testStatus.value = 'error';
    testErrorMsg.value = err instanceof Error ? err.message : String(err);
    message.error(testErrorMsg.value);
  } finally {
    testing.value = false;

    // 如果成功，3秒后恢复状态
    if (testStatus.value === 'success') {
      setTimeout(() => {
        if (testStatus.value === 'success') {
          testStatus.value = 'idle';
        }
      }, 3000);
    }
  }
}

// ==================== 辅助方法 ====================

// 移除未使用的辅助函数

// ==================== 生命周期 ====================

onMounted(() => {
  loadData();
});
</script>

<template>
  <div class="grid h-full min-w-0 grid-cols-[220px_minmax(0,1fr)] bg-background text-foreground">
    <aside class="flex min-w-0 flex-col border-r border-border/60 bg-surface/65">
      <div class="border-b border-border/50 px-3 py-3">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <h2 class="truncate text-sm font-semibold">模型供应商</h2>
            <p class="mt-0.5 text-[11px] text-muted-foreground">{{ enabledProviderCount }} 个已启用</p>
          </div>
          <span class="rounded-md bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground">
            {{ configuredProviderCount }}/{{ providers.length }}
          </span>
        </div>

        <div class="relative mt-3">
          <span class="i-carbon-search absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            v-model="providerQuery"
            type="search"
            class="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60"
            placeholder="搜索供应商" />
        </div>
      </div>

      <div class="flex-1 overflow-y-auto px-2 py-2">
        <div v-if="loading" class="flex flex-col items-center justify-center py-10 text-muted-foreground">
          <span class="i-carbon-circle-dash mb-3 inline-block h-6 w-6 animate-spin text-primary/70"></span>
          <p class="text-xs font-medium">加载中...</p>
        </div>

        <div v-else-if="error" class="rounded-lg border border-error/20 bg-error/10 p-3 text-center text-xs text-error">
          {{ error }}
          <button
            class="mt-3 inline-flex h-8 w-full items-center justify-center rounded-lg bg-error/10 font-medium transition-colors hover:bg-error/15"
            type="button"
            @click="loadData">
            重试
          </button>
        </div>

        <div v-else-if="filteredProviders.length === 0" class="px-3 py-8 text-center text-xs text-muted-foreground">
          没有匹配的供应商
        </div>

        <div v-else class="grid gap-1">
          <button
            v-for="provider in filteredProviders"
            :key="provider.id"
            :class="[
              'group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
              selectedProviderId === provider.id
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-background hover:text-foreground'
            ]"
            type="button"
            @click="selectProvider(provider.id)">
            <span
              class="h-2 w-2 shrink-0 rounded-full"
              :class="
                provider.enabled
                  ? selectedProviderId === provider.id
                    ? 'bg-primary-foreground'
                    : 'bg-success'
                  : 'bg-muted-foreground/35'
              " />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[13px] font-semibold leading-5">{{ provider.name }}</span>
              <span
                class="block truncate text-[11px] leading-4"
                :class="selectedProviderId === provider.id ? 'text-primary-foreground/70' : 'text-muted-foreground'">
                {{ provider.enabled ? (provider._hasApiKey ? '已配置' : '待配置') : '未启用' }}
              </span>
            </span>
          </button>
        </div>
      </div>
    </aside>

    <main class="min-w-0 overflow-y-auto">
      <div v-if="selectedProviderInfo" class="mx-auto max-w-5xl px-6 py-6 lg:px-8">
        <header class="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h1 class="text-xl font-semibold tracking-tight text-foreground">{{ selectedProviderInfo.name }}</h1>
              <span
                class="rounded-md px-2 py-1 text-[11px] font-medium"
                :class="config.enabled ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'">
                {{ config.enabled ? '已启用' : '未启用' }}
              </span>
            </div>
            <p class="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              {{ selectedProviderInfo.description || '模型服务连接配置。' }}
            </p>

            <div v-if="selectedProviderInfo.websites" class="mt-3 flex flex-wrap gap-3 text-xs font-medium">
              <a
                v-if="selectedProviderInfo.websites.official"
                :href="selectedProviderInfo.websites.official"
                target="_blank"
                class="inline-flex items-center gap-1 text-primary transition-colors hover:text-primary/80">
                <span class="i-carbon-home h-3.5 w-3.5"></span>
                官网
              </a>
              <a
                v-if="selectedProviderInfo.websites.apiKey"
                :href="selectedProviderInfo.websites.apiKey"
                target="_blank"
                class="inline-flex items-center gap-1 text-primary transition-colors hover:text-primary/80">
                <span class="i-carbon-key h-3.5 w-3.5"></span>
                API Key
              </a>
              <a
                v-if="selectedProviderInfo.websites.docs"
                :href="selectedProviderInfo.websites.docs"
                target="_blank"
                class="inline-flex items-center gap-1 text-primary transition-colors hover:text-primary/80">
                <span class="i-carbon-document h-3.5 w-3.5"></span>
                文档
              </a>
              <a
                v-if="selectedProviderInfo.websites.models"
                :href="selectedProviderInfo.websites.models"
                target="_blank"
                class="inline-flex items-center gap-1 text-primary transition-colors hover:text-primary/80">
                <span class="i-carbon-list-boxes h-3.5 w-3.5"></span>
                模型列表
              </a>
            </div>
          </div>

          <div class="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
            <span class="text-xs font-medium text-muted-foreground">启用</span>
            <button
              :class="[
                'relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40',
                config.enabled ? 'bg-primary' : 'bg-muted'
              ]"
              role="switch"
              type="button"
              :aria-checked="config.enabled"
              @click="handleToggleEnabled">
              <span
                aria-hidden="true"
                :class="[
                  'pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow ring-1 ring-border transition-transform',
                  config.enabled ? 'translate-x-4' : 'translate-x-0'
                ]"></span>
            </button>
          </div>
        </header>

        <div class="mb-5 grid gap-3 sm:grid-cols-3">
          <div class="rounded-lg border border-border bg-card px-4 py-3">
            <p class="text-[11px] font-medium text-muted-foreground">API 类型</p>
            <p class="mt-1 truncate text-sm font-semibold text-foreground">{{ selectedProviderInfo.api }}</p>
          </div>
          <div class="rounded-lg border border-border bg-card px-4 py-3">
            <p class="text-[11px] font-medium text-muted-foreground">凭证</p>
            <p
              class="mt-1 text-sm font-semibold"
              :class="selectedProviderInfo._hasApiKey ? 'text-success' : 'text-warning'">
              {{
                selectedProviderInfo.requiresApiKey === false
                  ? '无需凭证'
                  : selectedProviderInfo._hasApiKey
                    ? '已配置'
                    : '待配置'
              }}
            </p>
          </div>
          <div class="rounded-lg border border-border bg-card px-4 py-3">
            <p class="text-[11px] font-medium text-muted-foreground">模型数量</p>
            <p class="mt-1 text-sm font-semibold text-foreground">{{ selectedProviderModelCount }}</p>
          </div>
        </div>

        <section class="rounded-lg border border-border bg-card">
          <div class="border-b border-border/60 px-5 py-4">
            <h3 class="text-sm font-semibold text-foreground">连接配置</h3>
            <p class="mt-1 text-xs text-muted-foreground">修改后保存，测试连接会使用当前供应商配置。</p>
          </div>

          <div class="grid gap-5 px-5 py-5">
            <div class="grid gap-2">
              <label class="text-xs font-medium text-muted-foreground">API Base URL</label>
              <input
                v-model="config.baseUrl"
                type="text"
                class="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/60"
                placeholder="https://api.example.com/v1" />
            </div>

            <div class="grid gap-2">
              <label class="flex items-center justify-between gap-3 text-xs font-medium text-muted-foreground">
                <span>API Key</span>
                <span
                  v-if="selectedProviderInfo.requiresApiKey === false"
                  class="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                  <span class="i-carbon-information h-3 w-3"></span>
                  无需凭证
                </span>
                <span
                  v-else-if="selectedProviderInfo._hasApiKey"
                  class="inline-flex items-center gap-1 rounded-md bg-success/10 px-2 py-0.5 text-[11px] text-success">
                  <span class="i-carbon-checkmark h-3 w-3"></span>
                  已配置
                </span>
              </label>
              <input
                v-model="config.apiKey"
                type="password"
                class="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/60 disabled:cursor-not-allowed disabled:opacity-50"
                :placeholder="
                  selectedProviderInfo.requiresApiKey === false
                    ? '本地服务无需配置 API Key'
                    : selectedProviderInfo._hasApiKey
                      ? '输入新值以覆盖'
                      : 'sk-...'
                "
                :disabled="selectedProviderInfo.requiresApiKey === false" />
            </div>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-5 py-4">
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <button
                :disabled="
                  testing ||
                  (selectedProviderInfo.requiresApiKey !== false && !config.apiKey && !selectedProviderInfo._hasApiKey)
                "
                class="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border border-input bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                type="button"
                @click="handleTestConnection">
                <span v-if="testing" class="i-carbon-circle-dash h-3.5 w-3.5 animate-spin text-primary"></span>
                <span v-else class="i-carbon-connection-signal h-3.5 w-3.5"></span>
                {{ testing ? '测试中...' : '测试连接' }}
              </button>

              <span
                v-if="testStatus === 'success'"
                class="inline-flex h-8 items-center gap-1 rounded-lg bg-success/10 px-3 text-xs font-medium text-success">
                <span class="i-carbon-checkmark-filled h-3.5 w-3.5"></span>
                连接成功
              </span>
              <span
                v-else-if="testStatus === 'error'"
                class="inline-flex h-8 max-w-[320px] items-center gap-1 rounded-lg bg-error/10 px-3 text-xs font-medium text-error"
                :title="testErrorMsg">
                <span class="i-carbon-warning-filled h-3.5 w-3.5 shrink-0"></span>
                <span class="truncate">{{ testErrorMsg }}</span>
              </span>
            </div>

            <div class="flex items-center gap-3">
              <span v-if="saveStatus === 'success'" class="text-xs font-medium text-success">已保存</span>
              <span v-else-if="saveStatus === 'error'" class="text-xs font-medium text-error">保存失败</span>
              <button
                :disabled="saving"
                class="inline-flex h-8 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                type="button"
                @click="handleSave">
                <span v-if="saving" class="i-carbon-circle-dash h-3.5 w-3.5 animate-spin"></span>
                <span v-else class="i-carbon-save h-3.5 w-3.5"></span>
                {{ saving ? '保存中...' : '保存配置' }}
              </button>
            </div>
          </div>
        </section>

        <section class="mt-5 rounded-lg border border-border bg-card">
          <div class="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
            <div>
              <h3 class="text-sm font-semibold text-foreground">支持的模型</h3>
              <p class="mt-1 text-xs text-muted-foreground">模型窗口、能力和输出上限来自本地供应商配置。</p>
            </div>
            <span class="text-xs font-medium text-muted-foreground">{{ selectedProviderModelCount }} 个</span>
          </div>

          <div class="divide-y divide-border/60">
            <div
              v-for="model in selectedProviderInfo.models"
              :key="model.id"
              class="grid gap-2 px-5 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
              <div class="min-w-0">
                <div class="flex min-w-0 flex-wrap items-center gap-2">
                  <p class="truncate text-sm font-medium text-foreground">{{ model.name }}</p>
                  <span class="rounded-md bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                    {{ model.id }}
                  </span>
                </div>
                <div class="mt-2 flex flex-wrap gap-1.5">
                  <span v-if="model.reasoning" class="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                    推理
                  </span>
                  <span v-if="model.vision" class="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                    视觉
                  </span>
                  <span
                    v-if="model.functionCalling"
                    class="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                    工具调用
                  </span>
                  <span v-if="model.webSearch" class="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                    搜索
                  </span>
                </div>
              </div>

              <div class="flex flex-wrap gap-3 text-xs text-muted-foreground md:justify-end">
                <span v-if="model.contextWindow">{{ Math.round(model.contextWindow / 1000) }}K 上下文</span>
                <span v-if="model.maxOutputTokens">{{ Math.round(model.maxOutputTokens / 1000) }}K 输出</span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div v-else class="flex h-full items-center justify-center text-muted-foreground">
        <div class="text-center">
          <span class="i-carbon-machine-learning-model mb-3 block text-4xl opacity-20"></span>
          <p class="text-sm">请选择模型供应商</p>
        </div>
      </div>
    </main>
  </div>
</template>
