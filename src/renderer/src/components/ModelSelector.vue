<script setup lang="ts">
/**
 * ModelSelector - 可复用的模型选择器组件
 *
 * 特性：
 * - 按 Provider 分组展示所有可用模型
 * - 支持搜索和能力过滤
 * - 可选的模型详情和能力标签展示
 */

import { computed, onMounted, ref } from 'vue';
import { getProviders } from '@/api/config';
import { SelectInput } from '@/components/Form';
import type { SelectOptionGroup } from '@/components/Form/types';
import type { ProviderConfig, ModelConfig } from '@shared/api/config-types';

// Props 定义
interface Props {
  modelValue?: string;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  showDetails?: boolean;
  showCapabilities?: boolean;
  // 过滤选项
  filterByCapabilities?: {
    vision?: boolean;
    functionCalling?: boolean;
    reasoning?: boolean;
    webSearch?: boolean;
    supportsEmbedding?: boolean;
  };
}

const props = withDefaults(defineProps<Props>(), {
  label: '',
  placeholder: '请选择一个模型',
  disabled: false,
  required: false,
  showDetails: false,
  showCapabilities: true
});

// Emits 定义
interface Emits {
  (e: 'update:modelValue', value: string): void;
  (e: 'change', model: (ModelConfig & { providerName: string }) | undefined): void;
}

const emit = defineEmits<Emits>();

// 状态
const providers = ref<ProviderConfig[]>([]);
const loading = ref(true);

// 加载所有 Providers 和模型
async function loadProviders(): Promise<void> {
  loading.value = true;
  try {
    const result = await getProviders();
    if (result.success && result.data?.providers) {
      providers.value = Object.values(result.data.providers).filter(p => p.enabled);
    }
  } catch (err: unknown) {
    console.error('[ModelSelector] Failed to load providers:', err);
  } finally {
    loading.value = false;
  }
}

// 过滤模型
const filterModel = (model: ModelConfig): boolean => {
  if (!props.filterByCapabilities) return true;

  const filter = props.filterByCapabilities;

  if (filter.vision && !model.vision) return false;
  if (filter.functionCalling && !model.functionCalling) return false;
  if (filter.reasoning && !model.reasoning) return false;
  if (filter.webSearch && !model.webSearch) return false;
  if (filter.supportsEmbedding && !model.supportsEmbedding) return false;

  return true;
};

// 生成分组选项
const groupedOptions = computed((): SelectOptionGroup[] => {
  // 单个模型（按 Provider 分组）
  const providerGroups = providers.value
    .map((provider) => ({
      label: provider.name,
      options: (provider.models || [])
        .filter((model) => filterModel(model))
        .map((model) => {
          let description = '';
          if (model.features && model.features.length > 0) {
            description = model.features.join(' • ');
          }

          // 使用 providerId/modelId 格式作为 value，保证全局唯一性
          const fullModelId = `${provider.id}/${model.id}`;

          return {
            label: model.name,
            value: fullModelId,
            description,
            icon: 'i-carbon-machine-learning-model',
            model: { ...model, providerName: provider.name }
          };
        })
    }))
    .filter((group) => group.options.length > 0);

  return providerGroups;
});

// 获取当前选中的模型
const selectedModel = computed((): (ModelConfig & { providerName: string }) | undefined => {
  if (!props.modelValue) return undefined;

  // 解析 provider/model 格式
  const parts = props.modelValue.split('/');
  if (parts.length !== 2) return undefined;

  const [providerId, modelId] = parts;
  const provider = providers.value.find((p) => p.id === providerId);
  if (!provider) return undefined;

  const model = provider.models?.find((m) => m.id === modelId);
  if (model) {
    return { ...model, providerName: provider.name };
  }

  return undefined;
});

// 处理模型变化
const handleModelChange = (value: string | number | (string | number)[] | undefined): void => {
  const fullModelId = value as string;
  emit('update:modelValue', fullModelId);

  // 查找对应的模型
  let foundModel: (ModelConfig & { providerName: string }) | undefined;
  if (fullModelId) {
    const parts = fullModelId.split('/');
    if (parts.length === 2) {
      const [providerId, modelId] = parts;
      const provider = providers.value.find((p) => p.id === providerId);
      if (provider && provider.models) {
        const model = provider.models.find((m) => m.id === modelId);
        if (model) {
          foundModel = { ...model, providerName: provider.name };
        }
      }
    }
  }

  emit('change', foundModel);
};

onMounted(() => {
  loadProviders();
});
</script>

<template>
  <div class="model-selector">
    <SelectInput
      :model-value="modelValue"
      :label="label"
      :placeholder="loading ? '加载模型列表中...' : placeholder"
      :options="groupedOptions"
      :disabled="disabled || loading"
      :required="required"
      :error="error"
      :readonly="false"
      :searchable="true"
      grouped
      @update:model-value="handleModelChange" />

    <!-- 可选的模型详情显示 -->
    <div v-if="showDetails && selectedModel" class="mt-3 p-4 bg-card rounded-xl border border-border shadow-sm">
      <div class="flex items-center gap-2 mb-3">
        <span class="text-sm font-semibold text-foreground">{{ selectedModel.name }}</span>
        <span class="text-xs text-muted-foreground font-mono bg-muted/50 px-1.5 py-0.5 rounded-md border border-border/50">{{ selectedModel.id }}</span>
        <span class="text-xs text-muted-foreground ml-auto">{{ selectedModel.providerName }}</span>
      </div>

      <!-- 模型能力标签 -->
      <div v-if="showCapabilities" class="flex flex-wrap gap-2 mb-3">
        <span
          v-if="selectedModel.vision"
          class="px-2 py-1 text-[10px] bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-md font-medium border border-blue-500/20">
          视觉
        </span>
        <span
          v-if="selectedModel.supportsEmbedding"
          class="px-2 py-1 text-[10px] bg-purple-500/10 text-purple-600 dark:text-purple-400 rounded-md font-medium border border-purple-500/20">
          嵌入
        </span>
        <span
          v-if="selectedModel.functionCalling"
          class="px-2 py-1 text-[10px] bg-green-500/10 text-green-600 dark:text-green-400 rounded-md font-medium border border-green-500/20">
          函数调用
        </span>
        <span
          v-if="selectedModel.reasoning"
          class="px-2 py-1 text-[10px] bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-md font-medium border border-indigo-500/20">
          推理
        </span>
        <span
          v-if="selectedModel.webSearch"
          class="px-2 py-1 text-[10px] bg-teal-500/10 text-teal-600 dark:text-teal-400 rounded-md font-medium border border-teal-500/20">
          网络搜索
        </span>
        <span
          v-if="selectedModel.contextWindow"
          class="px-2 py-1 text-[10px] bg-gray-500/10 text-gray-600 dark:text-gray-400 rounded-md font-medium border border-gray-500/20">
          {{ Math.round(selectedModel.contextWindow / 1000) }}K 上下文
        </span>
      </div>

      <!-- 自定义特性标签 -->
      <div v-if="selectedModel.features && selectedModel.features.length > 0" class="flex flex-wrap gap-2">
        <span
          v-for="feature in selectedModel.features"
          :key="feature"
          class="px-2 py-1 text-[10px] bg-primary/10 text-primary rounded-md font-medium border border-primary/20">
          {{ feature }}
        </span>
      </div>
    </div>
  </div>
</template>
