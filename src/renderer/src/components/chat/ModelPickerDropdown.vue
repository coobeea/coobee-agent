<script setup lang="ts">
/**
 * ModelPickerDropdown — 紧凑模型下拉（可复用）
 *
 * 纯展示 + 选择：选项与持久化由父组件 / ChatComposer 提供。
 * 支持按 Provider 分组展示；按钮显示当前 provider + model。
 */
import { ref, watch, onUnmounted, computed } from 'vue';
import type { FlatConfigModelItem } from '@/composables/useFlatConfigModels';

const props = withDefaults(
  defineProps<{
    items: FlatConfigModelItem[];
    /** 当前选中的 provider/modelId，空字符串表示「默认模型」 */
    selectedValue: string;
    disabled?: boolean;
  }>(),
  { disabled: false }
);

const emit = defineEmits<{
  select: [value: string];
}>();

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);

const displayLabel = computed(() => {
  if (!props.selectedValue) return '默认模型';
  const hit = props.items.find((m) => m.value === props.selectedValue);
  if (!hit) return props.selectedValue;
  return `${hit.provider} · ${hit.label}`;
});

// 按 Provider 分组的模型列表
const groupedItems = computed(() => {
  const groups: Record<string, { providerName: string; models: FlatConfigModelItem[] }> = {};

  props.items.forEach((item) => {
    if (!groups[item.providerId]) {
      groups[item.providerId] = {
        providerName: item.provider,
        models: []
      };
    }
    groups[item.providerId].models.push(item);
  });

  return Object.values(groups);
});

function toggle(): void {
  if (props.disabled) return;
  open.value = !open.value;
}

function pick(value: string): void {
  emit('select', value);
  open.value = false;
}

function onDocMouseDown(e: MouseEvent): void {
  const el = rootRef.value;
  if (!el || !open.value) return;
  if (!el.contains(e.target as Node)) {
    open.value = false;
  }
}

watch(open, (v) => {
  if (v) {
    setTimeout(() => document.addEventListener('mousedown', onDocMouseDown), 0);
  } else {
    document.removeEventListener('mousedown', onDocMouseDown);
  }
});

onUnmounted(() => {
  document.removeEventListener('mousedown', onDocMouseDown);
});
</script>

<template>
  <div ref="rootRef" class="relative z-50 inline-flex shrink-0">
    <button
      type="button"
      class="relative inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
      :class="selectedValue ? 'text-primary hover:bg-primary/10 hover:text-primary' : ''"
      :disabled="disabled"
      :title="`模型：${displayLabel}`"
      :aria-label="`模型：${displayLabel}`"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="toggle">
      <span class="i-carbon-machine-learning-model inline-block h-3.5 w-3.5" />
      <span
        class="absolute right-0.5 top-0.5 h-1 w-1 rounded-full bg-primary transition-opacity"
        :class="selectedValue ? 'opacity-100' : 'opacity-0'" />
    </button>

    <div
      v-if="open"
      class="absolute bottom-full left-0 z-[60] mb-1 max-h-80 w-[280px] max-w-[min(100vw-2rem,320px)] overflow-y-auto rounded-lg border border-border/70 bg-background shadow-lg outline-none">
      <div class="border-b border-border/45 px-3 py-2">
        <div class="flex items-center justify-between gap-3">
          <span class="text-xs font-semibold text-foreground">模型</span>
          <span class="i-carbon-machine-learning-model inline-block h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <p class="mt-1 truncate text-xs text-muted-foreground">{{ displayLabel }}</p>
      </div>

      <!-- 默认模型选项 -->
      <div class="p-1">
        <button
          type="button"
          class="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-xs transition hover:bg-accent/80"
          :class="!selectedValue ? 'bg-primary/10 text-primary' : 'text-foreground'"
          @click="pick('')">
          <div class="flex flex-col gap-0.5">
            <span class="font-medium">默认模型</span>
            <span class="text-xs text-muted-foreground" :class="!selectedValue ? 'text-primary' : ''"
              >跟随 Agent 配置</span
            >
          </div>
          <span v-if="!selectedValue" class="i-carbon-checkmark inline-block h-3.5 w-3.5" />
        </button>
      </div>

      <!-- 按 Provider 分组展示模型 -->
      <template v-for="(group, index) in groupedItems" :key="group.providerName">
        <div v-if="index > 0" class="h-px w-full bg-border/50" />

        <div class="sticky top-0 bg-background px-3 py-1.5 text-xs font-semibold text-muted-foreground">
          {{ group.providerName }}
        </div>

        <div class="p-1">
          <button
            v-for="m in group.models"
            :key="m.value"
            type="button"
            class="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-xs transition hover:bg-accent/80"
            :class="selectedValue === m.value ? 'bg-primary/10 text-primary' : 'text-foreground'"
            @click="pick(m.value)">
            <span class="min-w-0 truncate pr-2 font-medium">{{ m.label }}</span>
            <span class="shrink-0 text-xs text-muted-foreground">{{ m.provider }}</span>
            <span
              v-if="selectedValue === m.value"
              class="i-carbon-checkmark inline-block h-3.5 w-3.5 shrink-0 text-primary" />
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
