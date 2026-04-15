<script setup lang="ts">
/**
 * BasicSettings - 基本配置组件
 */

import { ref, onMounted } from 'vue';
import ModelSelector from '@/components/ModelSelector.vue';
import { useMessageStore } from '@/components/Message';
import { getDefaultModel, updateDefaultModel } from '@/api/config';

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
</script>

<template>
  <div class="h-full overflow-y-auto p-8 lg:p-12 bg-background text-foreground">
    <div class="mx-auto max-w-3xl">
      <h2 class="text-2xl font-bold tracking-tight mb-8">基本配置</h2>

      <section>
        <h3 class="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">常规设置</h3>
        <div class="rounded-xl border border-border bg-card shadow-sm">
          <div class="flex flex-col divide-y divide-border text-sm">
            <!-- 开机启动 -->
            <div class="flex items-center justify-between p-6">
              <div>
                <p class="font-medium text-foreground text-base">开机自启动</p>
                <p class="text-sm text-muted-foreground mt-1">登录系统时自动启动应用服务</p>
              </div>
              <div class="h-6 w-11 rounded-full bg-muted cursor-not-allowed flex items-center p-0.5 border border-border opacity-50">
                <div class="h-5 w-5 rounded-full bg-background shadow-sm"></div>
              </div>
            </div>

            <!-- 默认模型 -->
            <div class="p-6">
              <div class="mb-4 flex items-center justify-between">
                <div>
                  <p class="font-medium text-foreground text-base">默认模型</p>
                  <p class="text-sm text-muted-foreground mt-1">对话时默认使用的 AI 模型</p>
                </div>
                <span v-if="saving" class="text-sm text-muted-foreground flex items-center gap-1.5">
                  <span class="i-carbon-in-progress inline-block h-4 w-4 animate-spin text-primary"></span>
                  保存中...
                </span>
              </div>
              
              <div class="flex items-center gap-2">
                <div class="w-full max-w-md">
                  <ModelSelector
                    v-model="defaultModel"
                    placeholder="请选择默认模型"
                    :show-details="true"
                    :show-capabilities="true"
                    :disabled="loading || saving"
                    @change="saveDefaultModel"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
