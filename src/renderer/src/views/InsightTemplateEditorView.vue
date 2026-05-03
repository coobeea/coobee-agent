<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { createInsightTemplate } from '@/api/insight';

interface TemplateModuleForm {
  id: string;
  label: string;
  prompt: string;
}

const router = useRouter();
const saving = ref(false);
const error = ref('');

const form = reactive({
  name: '',
  description: '',
  analysisPrompt: '',
  modules: [createModule()]
});

const validModuleCount = computed(
  () => form.modules.filter((module) => module.label.trim() && module.prompt.trim()).length
);

function createModule(): TemplateModuleForm {
  return {
    id: `module-${crypto.randomUUID()}`,
    label: '',
    prompt: ''
  };
}

function addModule(): void {
  form.modules.push(createModule());
}

function removeModule(moduleId: string): void {
  if (form.modules.length === 1) return;
  form.modules = form.modules.filter((module) => module.id !== moduleId);
}

function moveModule(moduleId: string, direction: 'up' | 'down'): void {
  const index = form.modules.findIndex((module) => module.id === moduleId);
  if (index < 0) return;
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= form.modules.length) return;

  const next = [...form.modules];
  const [item] = next.splice(index, 1);
  next.splice(targetIndex, 0, item);
  form.modules = next;
}

async function saveTemplate(): Promise<void> {
  if (saving.value) return;

  const normalizedModules = form.modules
    .map((module) => ({
      label: module.label.trim(),
      prompt: module.prompt.trim(),
      type: 'text' as const
    }))
    .filter((module) => module.label && module.prompt);

  if (!form.name.trim()) {
    error.value = '模板名称不能为空';
    return;
  }
  if (!form.description.trim()) {
    error.value = '模板说明不能为空';
    return;
  }
  if (!normalizedModules.length) {
    error.value = '至少需要配置一个有效的分析模块';
    return;
  }

  saving.value = true;
  error.value = '';
  try {
    const response = await createInsightTemplate({
      name: form.name.trim(),
      description: form.description.trim(),
      analysisPrompt: form.analysisPrompt.trim() || undefined,
      dimensions: normalizedModules
    });
    if (!response.success || !response.data) {
      throw new Error(response.error || '保存模板失败');
    }

    await router.push({
      name: 'insight',
      query: {
        openSelector: '1',
        templateId: response.data.template.id
      }
    });
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存模板失败';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-background text-foreground">
    <div class="mx-auto flex h-full w-full max-w-[1100px] flex-col px-6 py-6">
      <div class="mb-4 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <button
            class="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            @click="router.push('/insight')">
            <span class="i-carbon-arrow-left inline-block h-4 w-4" />
          </button>
          <div>
            <h1 class="text-lg font-semibold text-foreground">自定义模板</h1>
            <p class="text-sm text-muted-foreground">填写模板信息和分析模块，保存后可直接用于实时洞察</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-xs text-muted-foreground">{{ validModuleCount }} 个有效模块</span>
          <button
            class="rounded-md border border-border bg-card px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            @click="router.push('/insight')">
            取消
          </button>
          <button
            class="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="saving"
            @click="saveTemplate">
            <span
              v-if="saving"
              class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
            保存
          </button>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="space-y-4">
          <section class="rounded-lg border border-border bg-card p-5">
            <h2 class="mb-4 text-sm font-semibold text-foreground">基本信息</h2>
            <div class="grid grid-cols-2 gap-4">
              <label class="flex flex-col gap-2">
                <span class="text-sm text-foreground">模板名称</span>
                <input
                  v-model="form.name"
                  type="text"
                  placeholder="例如：销售跟进洞察"
                  class="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none transition-all focus:border-primary/40 focus:ring-2 focus:ring-primary/10" />
              </label>
              <label class="flex flex-col gap-2">
                <span class="text-sm text-foreground">模板说明</span>
                <input
                  v-model="form.description"
                  type="text"
                  placeholder="例如：用于复盘客户跟进对话"
                  class="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none transition-all focus:border-primary/40 focus:ring-2 focus:ring-primary/10" />
              </label>
            </div>

            <label class="mt-4 flex flex-col gap-2">
              <span class="text-sm text-foreground">整体分析提示词</span>
              <textarea
                v-model="form.analysisPrompt"
                rows="4"
                placeholder="可选。不填则按下方分析模块自动生成整体提示词。"
                class="rounded-md border border-border bg-background px-3 py-2.5 text-sm leading-6 outline-none transition-all focus:border-primary/40 focus:ring-2 focus:ring-primary/10" />
            </label>
          </section>

          <section class="rounded-lg border border-border bg-card p-5">
            <div class="mb-4 flex items-center justify-between">
              <h2 class="text-sm font-semibold text-foreground">分析模块</h2>
              <button
                class="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
                @click="addModule">
                <span class="i-carbon-add inline-block h-3.5 w-3.5" />
                添加模块
              </button>
            </div>

            <div class="space-y-4">
              <div
                v-for="(module, index) in form.modules"
                :key="module.id"
                class="rounded-md border border-border bg-background p-4">
                <div class="mb-3 flex items-center justify-between">
                  <div class="text-sm font-medium text-foreground">模块 {{ index + 1 }}</div>
                  <div class="flex items-center gap-2">
                    <button
                      class="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40"
                      :disabled="index === 0"
                      @click="moveModule(module.id, 'up')">
                      上移
                    </button>
                    <button
                      class="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40"
                      :disabled="index === form.modules.length - 1"
                      @click="moveModule(module.id, 'down')">
                      下移
                    </button>
                    <button
                      class="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-destructive/8 hover:text-destructive disabled:opacity-40"
                      :disabled="form.modules.length === 1"
                      @click="removeModule(module.id)">
                      删除
                    </button>
                  </div>
                </div>

                <label class="flex flex-col gap-2">
                  <span class="text-sm text-foreground">模块名称</span>
                  <input
                    v-model="module.label"
                    type="text"
                    placeholder="例如：客户核心诉求"
                    class="h-10 rounded-md border border-border bg-card px-3 text-sm outline-none transition-all focus:border-primary/40 focus:ring-2 focus:ring-primary/10" />
                </label>

                <label class="mt-4 flex flex-col gap-2">
                  <span class="text-sm text-foreground">分析提示词</span>
                  <textarea
                    v-model="module.prompt"
                    rows="4"
                    placeholder="例如：请提炼客户当前最关心的问题、背后的原因以及优先级。"
                    class="rounded-md border border-border bg-card px-3 py-2.5 text-sm leading-6 outline-none transition-all focus:border-primary/40 focus:ring-2 focus:ring-primary/10" />
                </label>
              </div>
            </div>
          </section>

          <div
            v-if="error"
            class="rounded-md border border-destructive/20 bg-destructive/6 px-4 py-3 text-sm text-destructive">
            {{ error }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
