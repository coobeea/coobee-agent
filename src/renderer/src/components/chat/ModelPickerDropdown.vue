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
  <div ref="rootRef" class="relative z-50 min-w-0 shrink-0">
    <button
      type="button"
      class="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-md border border-border/40 bg-background/80 px-2.5 py-1.5 text-left text-xs font-medium text-muted-foreground shadow-sm transition hover:border-primary/20 hover:bg-muted/60 hover:text-foreground hover:shadow disabled:cursor-not-allowed disabled:opacity-50"
      :disabled="disabled"
      @click="toggle">
      <span class="min-w-0 truncate">{{ displayLabel }}</span>
      <span
        class="i-carbon-chevron-down inline-block h-3 w-3 shrink-0 opacity-60 transition"
        :class="open ? 'rotate-180' : ''" />
    </button>

    <div
      v-if="open"
      class="absolute bottom-full left-0 z-[60] mb-1 max-h-80 min-w-[240px] max-w-[min(100vw-2rem,320px)] overflow-y-auto rounded-lg border border-border bg-background shadow-lg outline-none">
      <!-- 默认模型选项 -->
      <div class="p-1">
        <button
          type="button"
          class="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-xs transition hover:bg-accent/80"
          :class="!selectedValue ? 'bg-primary/10 text-primary' : 'text-foreground'"
          @click="pick('')">
          <div class="flex flex-col gap-0.5">
            <span class="font-medium">默认模型</span>
            <span class="text-[10px] text-muted-foreground" :class="!selectedValue ? 'text-primary/70' : ''"
              >跟随 Agent 配置</span
            >
          </div>
          <span v-if="!selectedValue" class="i-carbon-checkmark inline-block h-3.5 w-3.5" />
        </button>
      </div>

      <!-- 按 Provider 分组展示模型 -->
      <template v-for="(group, index) in groupedItems" :key="group.providerName">
        <div v-if="index > 0" class="h-px w-full bg-border/50" />

        <div
          class="sticky top-0 bg-muted/20 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 backdrop-blur-sm">
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
            <span class="shrink-0 text-[10px] text-muted-foreground">{{ m.provider }}</span>
            <span
              v-if="selectedValue === m.value"
              class="i-carbon-checkmark inline-block h-3.5 w-3.5 shrink-0 text-primary" />
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
