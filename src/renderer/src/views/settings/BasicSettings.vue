<script setup lang="ts">
/**
 * BasicSettings - 基本配置组件
 */

import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import ModelSelector from '@/components/ModelSelector.vue';
import { useMessageStore } from '@/components/Message';
import { getDefaultModel, updateDefaultModel } from '@/api/config';

const router = useRouter();
const message = useMessageStore();
const defaultModel = ref('');
const saving = ref(false);
const loading = ref(false);

// 加载默认模型
async function loadDefaultModel(): Promise<void> {
  loading.value = true;
  try {
    const result = await getDefaultModel();
    if (result.success && result.data) {
      defaultModel.value = result.data.modelId;
    } else {
      message.error(result.error || '加载默认模型失败');
    }
  } catch (err: unknown) {
    console.error('[BasicSettings] Failed to load default model:', err);
    message.error('加载默认模型失败');
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadDefaultModel();
});

// 保存默认模型
async function saveDefaultModel(): Promise<void> {
  if (!defaultModel.value) return;

  saving.value = true;
  try {
    const result = await updateDefaultModel(defaultModel.value);
    if (result.success) {
      console.log('[BasicSettings] Default model saved:', defaultModel.value);
      message.success('默认模型保存成功');
    } else {
      message.error(result.error || '保存默认模型失败');
    }
  } catch (err: unknown) {
    console.error('[BasicSettings] Failed to save default model:', err);
    message.error('保存默认模型失败');
  } finally {
    saving.value = false;
  }
}

// 重新运行引导
async function resetOnboarding(): Promise<void> {
  try {
    await window.api.onboarding.reset();
    message.success('正在重新启动引导...');
    setTimeout(() => {
      router.push('/welcome');
    }, 500);
  } catch (error) {
    console.error('重置引导失败:', error);
    message.error('操作失败，请重试');
  }
}
</script>

<template>
  <div class="h-full overflow-y-auto bg-background text-foreground">
    <div class="mx-auto max-w-4xl px-6 py-6 lg:px-8">
      <header class="mb-6 flex items-start justify-between gap-4">
        <div class="min-w-0">
          <h2 class="text-xl font-semibold tracking-tight">基本设置</h2>
          <p class="mt-1 text-sm text-muted-foreground">管理默认模型和应用级偏好。</p>
        </div>
        <span v-if="saving" class="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <span class="i-carbon-in-progress inline-block h-3.5 w-3.5 animate-spin text-primary"></span>
          保存中...
        </span>
      </header>

      <div class="grid gap-4">
        <section class="rounded-lg border border-border bg-card">
          <div class="border-b border-border/60 px-5 py-4">
            <h3 class="text-sm font-semibold text-foreground">全局默认</h3>
            <p class="mt-1 text-xs text-muted-foreground">这些设置会作为新任务和新智能体的默认行为。</p>
          </div>

          <div class="px-5 py-5">
            <div class="mb-3 flex items-center justify-between gap-4">
              <div class="min-w-0">
                <p class="text-sm font-medium text-foreground">默认模型</p>
                <p class="mt-1 text-xs text-muted-foreground">未单独指定模型时使用。</p>
              </div>
            </div>

            <div class="max-w-xl">
              <ModelSelector
                v-model="defaultModel"
                placeholder="请选择默认模型"
                :show-details="true"
                :show-capabilities="true"
                :disabled="loading || saving"
                @change="saveDefaultModel" />
            </div>
          </div>
        </section>

        <section class="rounded-lg border border-border bg-card">
          <div class="border-b border-border/60 px-5 py-4">
            <h3 class="text-sm font-semibold text-foreground">应用行为</h3>
            <p class="mt-1 text-xs text-muted-foreground">这里会继续承接外观、语言、主题等全局偏好。</p>
          </div>

          <div class="divide-y divide-border/60">
            <div class="flex items-center justify-between gap-4 px-5 py-4">
              <div class="min-w-0">
                <p class="text-sm font-medium text-foreground">开机自启动</p>
                <p class="mt-1 text-xs text-muted-foreground">登录系统时自动启动应用服务。</p>
              </div>
              <div
                class="flex h-5 w-9 cursor-not-allowed items-center rounded-full border border-border bg-muted p-0.5 opacity-50">
                <span class="h-4 w-4 rounded-full bg-background shadow-sm"></span>
              </div>
            </div>

            <div class="flex items-center justify-between gap-4 px-5 py-4">
              <div class="min-w-0">
                <p class="text-sm font-medium text-foreground">重新运行引导</p>
                <p class="mt-1 text-xs text-muted-foreground">回到首次使用时的配置流程。</p>
              </div>
              <button
                class="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-muted"
                type="button"
                @click="resetOnboarding">
                <span class="i-carbon-restart inline-block h-3.5 w-3.5"></span>
                重新运行
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
