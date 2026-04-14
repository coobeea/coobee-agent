<script setup lang="ts">
/**
 * ProviderSettings - 模型供应商管理
 *
 * 左右分栏：
 * - 左侧：供应商列表（含启用状态）
 * - 右侧：供应商配置详情（API Key / Base URL / 启用开关）
 */

import { ref, computed, onMounted } from 'vue';
import { 
  getProviders, 
  saveProviderKey, 
  updateProviderBaseUrl, 
  toggleProvider,
  testProvider
} from '@/api/config';
import type { ProviderConfig } from '@shared/api/config-types';

const providers = ref<ProviderConfig[]>([]);
const selectedProviderId = ref<string>('');

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
      
      // 如果没有选中项，默认选中第一个
      if (providers.value.length > 0 && !selectedProviderId.value) {
        selectProvider(sortedProviders.value[0].id);
      } else if (selectedProviderId.value) {
        // 如果已经有选中项，重新加载其配置（可能被其他地方修改）
        selectProvider(selectedProviderId.value);
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

// ==================== 计算属性 ====================

const enabledProviders = computed(() => providers.value.filter((p) => p.enabled));
const disabledProviders = computed(() => providers.value.filter((p) => !p.enabled));

// 排序：已启用的在前面
const sortedProviders = computed(() => [...enabledProviders.value, ...disabledProviders.value]);

const selectedProviderInfo = computed(() => {
  return providers.value.find((p) => p.id === selectedProviderId.value);
});

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

    // 重新加载数据以更新列表状态
    await loadData();
    
    // 恢复状态提示
    setTimeout(() => {
      saveStatus.value = 'idle';
    }, 2000);
    
  } catch (err) {
    saveStatus.value = 'error';
    console.error('保存配置失败:', err);
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
    } else {
      // 失败则回滚
      config.value.enabled = !config.value.enabled;
      console.error('切换启用状态失败:', result.error);
    }
  } catch (err) {
    // 失败则回滚
    config.value.enabled = !config.value.enabled;
    console.error('切换启用状态失败:', err);
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
    } else {
      testStatus.value = 'error';
      testErrorMsg.value = result.error || '连接测试失败';
    }
  } catch (err) {
    testStatus.value = 'error';
    testErrorMsg.value = err instanceof Error ? err.message : String(err);
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

function getStatusText(provider: ProviderConfig): string {
  if (!provider.enabled) return '未启用';
  if (provider._hasApiKey) return '已配置';
  return '未配置';
}

function getStatusColor(provider: ProviderConfig): string {
  if (!provider.enabled) return 'bg-gray-400';
  if (provider._hasApiKey) return 'bg-green-500';
  return 'bg-orange-400';
}

function getStatusTextColor(provider: ProviderConfig): string {
  if (!provider.enabled) return 'text-muted-foreground';
  if (provider._hasApiKey) return 'text-green-600';
  return 'text-orange-600';
}

// ==================== 生命周期 ====================

onMounted(() => {
  loadData();
});
</script>

<template>
  <div class="flex h-full bg-background">
    <!-- 左侧：供应商列表 -->
    <div class="flex w-64 flex-col border-r border-border bg-card/30">
      <div class="border-b border-border px-5 py-4">
        <h2 class="text-base font-semibold tracking-tight">模型供应商</h2>
        <p class="mt-1 text-xs text-muted-foreground">{{ providers.length }} 个供应商</p>
      </div>

      <div class="flex-1 overflow-y-auto p-3">
        <!-- 加载中 -->
        <div v-if="loading" class="flex flex-col items-center justify-center py-10 text-muted-foreground">
          <span class="i-carbon-circle-dash mb-3 inline-block h-8 w-8 animate-spin text-primary/70"></span>
          <p class="text-sm font-medium">加载中...</p>
        </div>
        
        <!-- 错误提示 -->
        <div v-else-if="error" class="p-4 text-sm text-red-500 text-center bg-red-500/10 rounded-lg mx-2 mt-2">
          {{ error }}
          <button @click="loadData" class="mt-3 block w-full rounded-md bg-red-500/20 py-1.5 text-red-600 hover:bg-red-500/30 transition-colors font-medium">重试</button>
        </div>

        <!-- Provider 卡片列表 -->
        <div v-else class="flex flex-col gap-1.5">
          <!-- 已启用分组 -->
          <template v-if="enabledProviders.length > 0">
            <p class="px-2 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              已启用 · {{ enabledProviders.length }}
            </p>
            <button
              v-for="provider in enabledProviders"
              :key="provider.id"
              :class="[
                'flex w-full items-center justify-between rounded-lg px-3 py-3 text-left text-sm transition-all border border-transparent',
                selectedProviderId === provider.id
                  ? 'bg-primary/10 border-primary/20 text-primary shadow-sm'
                  : 'text-foreground hover:bg-muted hover:border-border/50'
              ]"
              @click="selectProvider(provider.id)">
              <div class="flex flex-col overflow-hidden">
                <span class="truncate font-medium">{{ provider.name }}</span>
                <span :class="['mt-1 text-[11px] font-medium', getStatusTextColor(provider)]">
                  {{ getStatusText(provider) }}
                </span>
              </div>
              <div :class="['h-2.5 w-2.5 flex-shrink-0 rounded-full shadow-sm', getStatusColor(provider)]"></div>
            </button>
          </template>

          <!-- 未启用分组 -->
          <template v-if="disabledProviders.length > 0">
            <p class="px-2 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              未启用 · {{ disabledProviders.length }}
            </p>
            <button
              v-for="provider in disabledProviders"
              :key="provider.id"
              :class="[
                'flex w-full items-center justify-between rounded-lg px-3 py-3 text-left text-sm transition-all border border-transparent',
                selectedProviderId === provider.id
                  ? 'bg-primary/10 border-primary/20 text-primary shadow-sm'
                  : 'text-foreground hover:bg-muted hover:border-border/50'
              ]"
              @click="selectProvider(provider.id)">
              <div class="flex flex-col overflow-hidden opacity-70">
                <span class="truncate font-medium">{{ provider.name }}</span>
                <span :class="['mt-1 text-[11px] font-medium', getStatusTextColor(provider)]">
                  {{ getStatusText(provider) }}
                </span>
              </div>
              <div :class="['h-2.5 w-2.5 flex-shrink-0 rounded-full shadow-sm', getStatusColor(provider)]"></div>
            </button>
          </template>
        </div>
      </div>
    </div>

    <!-- 右侧：配置详情 -->
    <div class="flex-1 overflow-y-auto bg-background p-8 lg:p-12">
      <div v-if="selectedProviderInfo" class="mx-auto max-w-3xl">
        <!-- 头部：标题和启用开关 -->
        <div class="mb-8 flex items-start justify-between">
          <div>
            <h1 class="text-3xl font-bold tracking-tight text-foreground">{{ selectedProviderInfo.name }}</h1>
            <p class="mt-2 text-sm text-muted-foreground">{{ selectedProviderInfo.description || '无描述' }}</p>
            
            <!-- 网站链接 -->
            <div v-if="selectedProviderInfo.websites" class="mt-4 flex flex-wrap gap-4 text-xs font-medium">
              <a v-if="selectedProviderInfo.websites.official" :href="selectedProviderInfo.websites.official" target="_blank" class="flex items-center text-primary hover:text-primary/80 transition-colors">
                <span class="i-carbon-home mr-1.5 h-4 w-4"></span> 官网
              </a>
              <a v-if="selectedProviderInfo.websites.apiKey" :href="selectedProviderInfo.websites.apiKey" target="_blank" class="flex items-center text-primary hover:text-primary/80 transition-colors">
                <span class="i-carbon-key mr-1.5 h-4 w-4"></span> 获取 API Key
              </a>
              <a v-if="selectedProviderInfo.websites.docs" :href="selectedProviderInfo.websites.docs" target="_blank" class="flex items-center text-primary hover:text-primary/80 transition-colors">
                <span class="i-carbon-document mr-1.5 h-4 w-4"></span> 文档
              </a>
            </div>
          </div>
          
          <div class="flex items-center gap-3 bg-card px-4 py-2.5 rounded-xl border border-border shadow-sm">
            <span class="text-sm font-medium text-foreground">启用服务</span>
            <button
              @click="handleToggleEnabled"
              :class="[
                'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background',
                config.enabled ? 'bg-primary' : 'bg-muted'
              ]"
              role="switch"
              :aria-checked="config.enabled">
              <span
                aria-hidden="true"
                :class="[
                  'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                  config.enabled ? 'translate-x-5' : 'translate-x-0'
                ]"></span>
            </button>
          </div>
        </div>

        <!-- 配置表单 -->
        <div class="space-y-8 rounded-xl border border-border bg-card p-8 shadow-sm">
          <h3 class="text-lg font-semibold tracking-tight text-foreground border-b border-border pb-4">连接配置</h3>
          
          <!-- API 类型标识 -->
          <div class="flex items-center gap-2">
            <span class="text-xs font-medium text-muted-foreground w-20">API 类型:</span>
            <span class="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
              {{ selectedProviderInfo.api }}
            </span>
          </div>

          <!-- Base URL -->
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium text-foreground">API Base URL</label>
            <input
              v-model="config.baseUrl"
              type="text"
              class="rounded-lg border border-input bg-background px-4 py-2.5 text-sm shadow-sm transition-colors hover:bg-accent/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="https://api.example.com/v1" />
            <p class="text-xs text-muted-foreground">通常不需要修改，除非使用代理或私有部署。</p>
          </div>

          <!-- API Key -->
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium text-foreground flex justify-between">
              <span>API Key</span>
              <span v-if="selectedProviderInfo._hasApiKey" class="text-green-600 text-xs flex items-center bg-green-500/10 px-2 py-0.5 rounded-md">
                <span class="i-carbon-checkmark-outline mr-1"></span> 已配置
              </span>
            </label>
            <div class="relative">
              <input
                v-model="config.apiKey"
                type="password"
                class="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm shadow-sm transition-colors hover:bg-accent/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                :placeholder="selectedProviderInfo._hasApiKey ? '•••••••••••••••• (输入新值以覆盖)' : 'sk-...'" />
            </div>
            <p class="text-xs text-muted-foreground">API Key 保存在本地安全的 secrets.json5 文件中，不会随配置导出。</p>
          </div>

          <!-- 底部操作区 -->
          <div class="flex items-center justify-between pt-6 border-t border-border mt-8">
            <!-- 测试连接 -->
            <div class="flex items-center gap-3">
              <button
                @click="handleTestConnection"
                :disabled="testing || (!config.apiKey && !selectedProviderInfo._hasApiKey)"
                class="flex items-center gap-2 rounded-lg border border-input bg-background px-5 py-2.5 text-sm font-medium text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground disabled:opacity-50 transition-colors">
                <span v-if="testing" class="i-carbon-circle-dash animate-spin text-primary"></span>
                <span v-else class="i-carbon-connection-signal"></span>
                {{ testing ? '测试中...' : '测试连接' }}
              </button>
              
              <span v-if="testStatus === 'success'" class="text-sm font-medium text-green-600 flex items-center bg-green-500/10 px-3 py-1.5 rounded-md border border-green-500/20">
                <span class="i-carbon-checkmark-filled mr-1.5"></span> 连接成功
              </span>
              <span v-else-if="testStatus === 'error'" class="text-sm font-medium text-red-500 flex items-center bg-red-500/10 px-3 py-1.5 rounded-md border border-red-500/20">
                <span class="i-carbon-warning-filled mr-1.5"></span> {{ testErrorMsg }}
              </span>
            </div>

            <!-- 保存配置 -->
            <div class="flex items-center gap-4">
              <span v-if="saveStatus === 'success'" class="text-sm font-medium text-green-600 flex items-center">
                <span class="i-carbon-checkmark mr-1.5"></span> 已保存
              </span>
              <span v-else-if="saveStatus === 'error'" class="text-sm font-medium text-red-500 flex items-center">
                <span class="i-carbon-warning mr-1.5"></span> 保存失败
              </span>
              
              <button
                @click="handleSave"
                :disabled="saving"
                class="flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors shadow-sm">
                <span v-if="saving" class="i-carbon-circle-dash animate-spin"></span>
                <span v-else class="i-carbon-save"></span>
                {{ saving ? '保存中...' : '保存配置' }}
              </button>
            </div>
          </div>
        </div>
        
        <!-- 模型列表预览 -->
        <div class="mt-10">
          <h3 class="text-base font-semibold tracking-tight text-foreground mb-4 flex items-center justify-between">
            <span>支持的模型 ({{ selectedProviderInfo.models.length }})</span>
          </h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div 
              v-for="model in selectedProviderInfo.models" 
              :key="model.id"
              class="border border-border rounded-xl p-4 bg-card text-sm flex flex-col shadow-sm hover:shadow-md transition-shadow hover:border-primary/30"
            >
              <div class="font-semibold text-foreground mb-1.5">{{ model.name }}</div>
              <div class="text-xs text-muted-foreground font-mono bg-muted/50 px-2 py-1 rounded-md w-fit">{{ model.id }}</div>
              
              <div class="mt-3 flex flex-wrap gap-1.5">
                <span v-if="model.reasoning" class="inline-flex items-center rounded-md bg-purple-500/10 px-2 py-1 text-[10px] font-medium text-purple-700 dark:text-purple-400 ring-1 ring-inset ring-purple-500/20">推理</span>
                <span v-if="model.vision" class="inline-flex items-center rounded-md bg-blue-500/10 px-2 py-1 text-[10px] font-medium text-blue-700 dark:text-blue-400 ring-1 ring-inset ring-blue-500/20">视觉</span>
                <span v-if="model.functionCalling" class="inline-flex items-center rounded-md bg-green-500/10 px-2 py-1 text-[10px] font-medium text-green-700 dark:text-green-400 ring-1 ring-inset ring-green-500/20">函数调用</span>
                <span v-if="model.contextWindow" class="inline-flex items-center rounded-md bg-gray-500/10 px-2 py-1 text-[10px] font-medium text-gray-700 dark:text-gray-400 ring-1 ring-inset ring-gray-500/20">{{ Math.round(model.contextWindow / 1000) }}K ctx</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 未选择状态 -->
      <div v-else class="flex h-full items-center justify-center text-muted-foreground">
        <div class="text-center">
          <span class="i-carbon-machine-learning-model text-4xl mb-3 opacity-20 block mx-auto"></span>
          <p>请在左侧选择一个模型供应商</p>
        </div>
      </div>
    </div>
  </div>
</template>
