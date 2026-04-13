<script setup lang="ts">
/**
 * BasicSettings - 基本配置组件
 */

import { ref } from 'vue';

const defaultModel = ref('');
const execApprovalMode = ref<'auto' | 'always' | 'never'>('auto');
const saving = ref(false);
const savingApproval = ref(false);

// 模拟保存默认模型
async function saveDefaultModel(): Promise<void> {
  saving.value = true;
  try {
    // TODO: 实现实际的保存逻辑
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log('[BasicSettings] Default model saved:', defaultModel.value);
  } catch (err: unknown) {
    console.error('[BasicSettings] Failed to save default model:', err);
  } finally {
    saving.value = false;
  }
}

// 模拟保存审批策略
async function saveApprovalMode(): Promise<void> {
  savingApproval.value = true;
  try {
    // TODO: 实现实际的保存逻辑
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log('[BasicSettings] Approval mode saved:', execApprovalMode.value);
  } catch (err: unknown) {
    console.error('[BasicSettings] Failed to save approval mode:', err);
  } finally {
    savingApproval.value = false;
  }
}
</script>

<template>
  <div class="h-full overflow-y-auto p-6 lg:p-10 bg-background text-foreground">
    <div class="mx-auto max-w-3xl">
      <h2 class="text-xl font-bold mb-6">基本配置</h2>

      <section>
        <h3 class="text-sm font-semibold mb-4">常规设置</h3>
        <div class="rounded-lg border border-border bg-card p-6">
          <div class="flex flex-col divide-y divide-border text-sm">
            <!-- 开机启动 -->
            <div class="flex items-center justify-between py-4">
              <div>
                <p class="font-medium text-foreground">开机自启动</p>
                <p class="text-xs text-muted-foreground mt-1">登录系统时自动启动应用服务</p>
              </div>
              <div class="h-5 w-9 rounded-full bg-muted cursor-not-allowed flex items-center p-0.5 border border-border opacity-50">
                <div class="h-4 w-4 rounded-full bg-background shadow-sm"></div>
              </div>
            </div>

            <!-- 默认模型 -->
            <div class="py-4">
              <div class="mb-3 flex items-center justify-between">
                <div>
                  <p class="font-medium text-foreground">默认模型</p>
                  <p class="text-xs text-muted-foreground mt-1">对话时默认使用的 AI 模型</p>
                </div>
                <span v-if="saving" class="text-xs text-muted-foreground flex items-center gap-1">
                  <span class="i-carbon-in-progress inline-block h-3 w-3 animate-spin"></span>
                  保存中...
                </span>
              </div>
              
              <div class="flex items-center gap-2">
                <select 
                  v-model="defaultModel" 
                  class="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  @change="saveDefaultModel"
                >
                  <option value="" disabled>请选择默认模型</option>
                  <option value="gpt-4o">GPT-4o</option>
                  <option value="claude-3-5-sonnet">Claude 3.5 Sonnet</option>
                  <option value="qwen-max">Qwen Max</option>
                </select>
              </div>
            </div>

            <!-- 命令审批策略 -->
            <div class="py-4">
              <div class="mb-3 flex items-center justify-between">
                <div>
                  <p class="font-medium text-foreground">命令执行审批</p>
                  <p class="text-xs text-muted-foreground mt-1">Agent 执行 Shell 命令时的安全审批策略</p>
                </div>
                <span v-if="savingApproval" class="text-xs text-muted-foreground flex items-center gap-1">
                  <span class="i-carbon-in-progress inline-block h-3 w-3 animate-spin"></span>
                  保存中...
                </span>
              </div>
              
              <div class="flex items-center gap-2">
                <select 
                  v-model="execApprovalMode" 
                  class="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  @change="saveApprovalMode"
                >
                  <option value="auto">智能模式 (仅高危命令需审批)</option>
                  <option value="always">严格模式 (所有命令均需审批)</option>
                  <option value="never">宽松模式 (无需审批，不推荐)</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
