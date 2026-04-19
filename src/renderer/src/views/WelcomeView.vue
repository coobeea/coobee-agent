<script setup lang="ts">
/**
 * WelcomeView — 欢迎引导页
 *
 * 3 步向导：欢迎介绍 → 选择供应商 → 配置供应商 → 完成
 */

import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useMessageStore } from '@/components/Message';
import { getProviders, saveProviderKey, toggleProvider, testProvider, updateProviderBaseUrl } from '@/api/config';
import type { ProviderConfig } from '@shared/api/config-types';

const router = useRouter();
const message = useMessageStore();

// 当前步骤（1-3）
const currentStep = ref(1);
const totalSteps = 3;

// 所有可用的供应商（从后台获取）
const allProviders = ref<ProviderConfig[]>([]);
const loading = ref(false);

// 用户选择的供应商 ID 列表
const selectedProviderIds = ref<string[]>([]);

// 当前正在配置的供应商
const currentConfigIndex = ref(0);

// 配置表单数据
interface ConfigFormData {
  apiKey: string;
  baseUrl: string;
  testing: boolean;
  testResult: 'idle' | 'success' | 'error';
  testMessage: string;
}

const configForm = ref<ConfigFormData>({
  apiKey: '',
  baseUrl: '',
  testing: false,
  testResult: 'idle',
  testMessage: ''
});

// 已配置完成的供应商 ID 列表
const configuredProviderIds = ref<string[]>([]);

// 当前正在配置的供应商信息
const currentProvider = computed(() => {
  if (selectedProviderIds.value.length === 0) return null;
  const providerId = selectedProviderIds.value[currentConfigIndex.value];
  return allProviders.value.find((p) => p.id === providerId);
});

// 是否可以继续下一步
const canProceed = computed(() => {
  if (currentStep.value === 1) return true; // 欢迎页
  if (currentStep.value === 2) {
    // 至少选择一个供应商
    return selectedProviderIds.value.length > 0;
  }
  if (currentStep.value === 3) {
    // 当前供应商已配置，或者可以跳过
    return true;
  }
  return true;
});

// 加载供应商列表
async function loadProviders(): Promise<void> {
  loading.value = true;
  try {
    const result = await getProviders();
    if (result.success && result.data) {
      allProviders.value = Object.values(result.data.providers);
      
      // 标记已经启用的供应商为已配置
      configuredProviderIds.value = allProviders.value
        .filter((p) => p.enabled)
        .map((p) => p.id);
    } else {
      message.error(result.error || '加载供应商列表失败');
    }
  } catch (error) {
    console.error('加载供应商失败:', error);
    message.error('加载供应商列表失败');
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadProviders();
});

// 切换供应商选择
function toggleProviderSelection(providerId: string): void {
  const index = selectedProviderIds.value.indexOf(providerId);
  if (index > -1) {
    selectedProviderIds.value.splice(index, 1);
  } else {
    selectedProviderIds.value.push(providerId);
  }
}

// 是否已选择某个供应商
function isProviderSelected(providerId: string): boolean {
  return selectedProviderIds.value.includes(providerId);
}

// 检查供应商是否已配置
function isProviderConfigured(providerId: string): boolean {
  return configuredProviderIds.value.includes(providerId);
}

// 测试当前供应商连接
async function handleTestProvider(): Promise<void> {
  if (!currentProvider.value) return;

  const provider = currentProvider.value;
  const needsApiKey = provider.id !== 'ollama';

  if (needsApiKey && !configForm.value.apiKey) {
    message.warning('请输入 API Key');
    return;
  }

  configForm.value.testing = true;
  configForm.value.testResult = 'idle';

  try {
    // 先保存配置
    if (configForm.value.apiKey) {
      await saveProviderKey(provider.id, configForm.value.apiKey);
    }
    if (configForm.value.baseUrl) {
      await updateProviderBaseUrl(provider.id, configForm.value.baseUrl);
    }

    // 测试连接
    const result = await testProvider(provider.id);

    if (result.success && result.data?.connected) {
      configForm.value.testResult = 'success';
      configForm.value.testMessage = `连接成功！延迟: ${result.data.latency}ms`;

      // 自动启用供应商
      await toggleProvider(provider.id, true);

      // 标记为已配置
      if (!configuredProviderIds.value.includes(provider.id)) {
        configuredProviderIds.value.push(provider.id);
      }

      message.success(`${provider.name} 配置成功`);
    } else {
      configForm.value.testResult = 'error';
      configForm.value.testMessage = result.error || '连接失败';
      message.error(`${provider.name} 连接失败: ${configForm.value.testMessage}`);
    }
  } catch (error) {
    configForm.value.testResult = 'error';
    configForm.value.testMessage = error instanceof Error ? error.message : '连接失败';
    message.error(`${provider.name} 连接失败: ${configForm.value.testMessage}`);
  } finally {
    configForm.value.testing = false;
  }
}

// 配置下一个供应商
function handleNextProvider(): void {
  if (currentConfigIndex.value < selectedProviderIds.value.length - 1) {
    currentConfigIndex.value++;
    
    // 初始化下一个供应商的配置表单（读取已有配置）
    if (currentProvider.value) {
      initConfigForm(currentProvider.value);
    }
  } else {
    // 所有供应商配置完成，直接完成引导
    completeOnboarding();
  }
}

// 跳过当前供应商配置
function handleSkipProvider(): void {
  handleNextProvider();
}

// 初始化配置表单（从供应商已有配置中读取）
function initConfigForm(provider: ProviderConfig): void {
  configForm.value = {
    apiKey: '', // API Key 不从后端读取（安全考虑）
    baseUrl: provider.baseUrl || '',
    testing: false,
    testResult: 'idle',
    testMessage: ''
  };
}

// 下一步
function handleNext(): void {
  if (!canProceed.value) return;

  if (currentStep.value === 2) {
    // 从选择供应商进入配置步骤
    if (selectedProviderIds.value.length > 0) {
      currentConfigIndex.value = 0;
      currentStep.value = 3;
      
      // 初始化第一个供应商的配置表单
      if (currentProvider.value) {
        initConfigForm(currentProvider.value);
      }
    }
  } else if (currentStep.value < totalSteps) {
    currentStep.value++;
  } else {
    // 完成引导
    completeOnboarding();
  }
}

// 上一步
function handlePrevious(): void {
  if (currentStep.value === 3) {
    // 从配置页返回选择页，重置配置索引
    currentConfigIndex.value = 0;
    currentStep.value = 2;
  } else if (currentStep.value > 1) {
    currentStep.value--;
  }
}

// 跳过引导
async function handleSkip(): Promise<void> {
  try {
    // 标记引导完成（避免反复弹出）
    await window.api.onboarding.complete();
    router.push('/home');
    message.info('您可以稍后在"设置"中配置模型供应商');
  } catch (error) {
    console.error('跳过引导失败:', error);
    message.error('操作失败，请重试');
  }
}

// 完成引导
async function completeOnboarding(): Promise<void> {
  try {
    // 标记引导完成
    await window.api.onboarding.complete();

    // 跳转到主页
    router.push('/home');

    message.success('配置完成！欢迎使用 Coobee Agent');
  } catch (error) {
    console.error('完成引导失败:', error);
    message.error('操作失败，请重试');
  }
}

// 配置进度文本
const configProgressText = computed(() => {
  return `${currentConfigIndex.value + 1} / ${selectedProviderIds.value.length}`;
});
</script>

<template>
  <div class="min-h-screen bg-background py-6 px-6">
    <div class="mx-auto w-full max-w-2xl">
      <!-- 步骤指示器 -->
      <div class="mb-8 flex justify-center gap-2">
        <div
          v-for="step in totalSteps"
          :key="step"
          class="h-1 w-20 rounded-full transition-colors duration-300"
          :class="step <= currentStep ? 'bg-primary' : 'bg-muted'"></div>
      </div>

      <!-- 主卡片 -->
      <div class="rounded-2xl bg-surface p-8 shadow-lg max-h-[calc(100vh-8rem)] flex flex-col">
        <!-- 内容区域（可滚动） -->
        <div class="flex-1 overflow-y-auto min-h-0">
          <!-- 步骤 1: 欢迎介绍 -->
          <div v-if="currentStep === 1" class="space-y-6">
          <div class="flex flex-col items-center text-center">
            <div
              class="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/10 text-primary ring-1 ring-primary/20">
              <span class="i-carbon-rocket text-5xl"></span>
            </div>

            <h1 class="text-3xl font-bold tracking-tight text-foreground">欢迎使用 Coobee Agent</h1>
            <p class="mt-3 text-lg text-muted-foreground">强大的 AI 智能体管理平台</p>

            <div class="mt-8 space-y-3 text-left text-muted-foreground">
              <div class="flex items-start gap-3">
                <span class="i-carbon-checkmark-filled mt-1 text-success"></span>
                <span>管理和运行多种 AI 智能体</span>
              </div>
              <div class="flex items-start gap-3">
                <span class="i-carbon-checkmark-filled mt-1 text-success"></span>
                <span>支持多种模型供应商（OpenAI、Anthropic、本地模型等）</span>
              </div>
              <div class="flex items-start gap-3">
                <span class="i-carbon-checkmark-filled mt-1 text-success"></span>
                <span>强大的对话和任务管理功能</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 步骤 2: 选择供应商 -->
        <div v-if="currentStep === 2" class="space-y-6">
          <div class="text-center">
            <div
              class="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <span class="i-carbon-machine-learning-model text-4xl"></span>
            </div>
            <h2 class="text-2xl font-bold text-foreground">选择模型供应商</h2>
            <p class="mt-2 text-sm text-muted-foreground">选择您想要使用的模型供应商（可多选）</p>
          </div>

          <!-- 加载中 -->
          <div v-if="loading" class="flex items-center justify-center py-12">
            <span class="i-carbon-renew inline-block h-8 w-8 animate-spin text-primary"></span>
          </div>

          <!-- 供应商列表 -->
          <div v-else class="grid grid-cols-1 gap-3">
            <button
              v-for="provider in allProviders"
              :key="provider.id"
              class="group flex items-center justify-between rounded-xl border p-4 text-left transition-all"
              :class="
                isProviderSelected(provider.id)
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-background hover:border-primary/50 hover:bg-muted/30'
              "
              @click="toggleProviderSelection(provider.id)">
              <div class="flex items-center gap-3 flex-1 min-w-0">
                <div
                  class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors"
                  :class="
                    isProviderSelected(provider.id)
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary'
                  ">
                  <span class="i-carbon-machine-learning-model text-xl"></span>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <p class="font-semibold text-foreground">{{ provider.name }}</p>
                    <span
                      v-if="provider.enabled"
                      class="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                      已配置
                    </span>
                  </div>
                  <p class="text-xs text-muted-foreground">{{ provider.id }}</p>
                </div>
              </div>

              <div
                v-if="isProviderSelected(provider.id)"
                class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <span class="i-carbon-checkmark text-sm"></span>
              </div>
              <div
                v-else
                class="h-6 w-6 shrink-0 rounded-full border-2 border-muted transition-colors group-hover:border-primary"></div>
            </button>
          </div>

          <!-- 提示信息 -->
          <div
            v-if="!canProceed"
            class="flex items-start gap-3 rounded-lg bg-warning/10 p-4 text-sm text-warning">
            <span class="i-carbon-warning-alt mt-0.5 shrink-0"></span>
            <span>请至少选择一个供应商</span>
          </div>
        </div>

        <!-- 步骤 3: 配置供应商 -->
        <div v-if="currentStep === 3 && currentProvider" class="space-y-6">
          <div class="text-center">
            <div
              class="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <span class="i-carbon-settings text-4xl"></span>
            </div>
            <h2 class="text-2xl font-bold text-foreground">配置 {{ currentProvider.name }}</h2>
            <p class="mt-2 text-sm text-muted-foreground">
              配置进度: {{ configProgressText }}
            </p>
          </div>

          <div class="space-y-4">
            <!-- API Key 输入（Ollama 不需要） -->
            <div v-if="currentProvider.id !== 'ollama'">
              <label class="mb-1.5 block text-sm font-medium text-foreground"> API Key * </label>
              <input
                v-model="configForm.apiKey"
                type="password"
                placeholder="sk-..."
                class="w-full rounded-lg border border-border bg-input-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>

            <!-- Base URL 输入（可选） -->
            <div>
              <label class="mb-1.5 block text-sm font-medium text-foreground"> Base URL (可选) </label>
              <input
                v-model="configForm.baseUrl"
                type="text"
                :placeholder="currentProvider.id === 'ollama' ? 'http://localhost:11434' : '留空使用默认'"
                class="w-full rounded-lg border border-border bg-input-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>

            <!-- 测试按钮和结果 -->
            <div class="space-y-3">
              <button
                class="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-all hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="configForm.testing || (currentProvider.id !== 'ollama' && !configForm.apiKey)"
                @click="handleTestProvider">
                <span v-if="configForm.testing" class="i-carbon-renew animate-spin"></span>
                <span v-else class="i-carbon-play-filled"></span>
                {{ configForm.testing ? '测试中...' : '测试连接' }}
              </button>

              <!-- 测试结果 -->
              <div
                v-if="configForm.testResult === 'success'"
                class="flex items-center gap-2 rounded-lg bg-success/10 p-3 text-sm text-success">
                <span class="i-carbon-checkmark-filled"></span>
                <span>{{ configForm.testMessage }}</span>
              </div>
              <div
                v-if="configForm.testResult === 'error'"
                class="flex items-center gap-2 rounded-lg bg-error/10 p-3 text-sm text-error">
                <span class="i-carbon-warning-alt"></span>
                <span>{{ configForm.testMessage }}</span>
              </div>
            </div>
          </div>

          <!-- 操作按钮 -->
          <div class="flex items-center justify-between border-t border-border pt-4">
            <button
              class="text-sm text-muted-foreground transition-colors hover:text-foreground"
              @click="handleSkipProvider">
              跳过此供应商
            </button>

            <button
              v-if="configForm.testResult === 'success'"
              class="flex items-center gap-2 rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground transition-all hover:bg-primary-hover"
              @click="handleNextProvider">
              {{ currentConfigIndex < selectedProviderIds.length - 1 ? '下一个供应商' : '完成配置' }}
              <span class="i-carbon-arrow-right"></span>
            </button>
          </div>

          <div class="rounded-lg bg-muted/30 p-4 text-xs text-muted-foreground">
            <p class="flex items-start gap-2">
              <span class="i-carbon-information mt-0.5 shrink-0"></span>
              <span>测试成功后，配置将自动保存。您可以稍后在"设置 → 模型控制"中修改配置</span>
            </p>
          </div>
        </div>

        </div>

        <!-- 按钮区域（固定在底部） -->
        <div v-if="currentStep !== 3" class="mt-8 flex items-center justify-between border-t border-border pt-6 shrink-0">
          <button
            v-if="currentStep > 1 && currentStep !== 3"
            class="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            @click="handlePrevious">
            <span class="i-carbon-arrow-left"></span>
            上一步
          </button>
          <div v-else></div>

          <div class="flex items-center gap-3">
            <button
              v-if="currentStep < totalSteps && currentStep !== 3"
              class="text-sm text-muted-foreground transition-colors hover:text-foreground"
              @click="handleSkip">
              跳过引导
            </button>

            <button
              class="flex items-center gap-2 rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground transition-all hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="!canProceed"
              @click="handleNext">
              {{ currentStep === totalSteps ? '开始使用' : '下一步' }}
              <span class="i-carbon-arrow-right"></span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
