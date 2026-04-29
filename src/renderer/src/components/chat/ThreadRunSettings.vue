<script setup lang="ts">
/**
 * ThreadRunSettings — Thread 级运行配置入口。
 */
import { computed, onUnmounted, ref, watch } from 'vue';
import type { ThreadRuntimeType } from '@shared/events/thread';

const props = withDefaults(
  defineProps<{
    runtimeType?: ThreadRuntimeType;
    asrEnabled?: boolean;
    ttsEnabled?: boolean;
    disabled?: boolean;
  }>(),
  {
    runtimeType: 'pi-mono',
    asrEnabled: false,
    ttsEnabled: false,
    disabled: false
  }
);

const emit = defineEmits<{
  'update:runtimeType': [value: ThreadRuntimeType];
  'update:asrEnabled': [value: boolean];
  'update:ttsEnabled': [value: boolean];
}>();

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);

const runtimeOptions: Array<{ value: ThreadRuntimeType; label: string }> = [
  { value: 'pi-mono', label: 'Pi' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'claude', label: 'Claude' }
];

const activeCount = computed(() => Number(props.asrEnabled) + Number(props.ttsEnabled));
const isChanged = computed(() => props.runtimeType !== 'pi-mono' || activeCount.value > 0);
const title = computed(() => {
  const voice = [props.asrEnabled ? 'ASR' : '', props.ttsEnabled ? 'TTS' : ''].filter(Boolean).join(' + ');
  return voice ? `运行配置：${props.runtimeType} · ${voice}` : `运行配置：${props.runtimeType}`;
});

function toggleOpen(): void {
  if (props.disabled) return;
  open.value = !open.value;
}

function pickRuntime(value: ThreadRuntimeType): void {
  if (props.disabled || value === props.runtimeType) return;
  emit('update:runtimeType', value);
}

function toggleAsr(): void {
  if (props.disabled) return;
  emit('update:asrEnabled', !props.asrEnabled);
}

function toggleTts(): void {
  if (props.disabled) return;
  emit('update:ttsEnabled', !props.ttsEnabled);
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
      class="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
      :class="isChanged ? 'text-primary hover:bg-primary/10 hover:text-primary' : ''"
      :disabled="disabled"
      :title="title"
      :aria-label="title"
      @click="toggleOpen">
      <span class="i-carbon-settings-adjust inline-block h-3.5 w-3.5" />
    </button>

    <div
      v-if="open"
      class="absolute bottom-full left-0 z-[70] mb-1 w-[236px] rounded-lg border border-border/70 bg-background p-2 text-foreground shadow-lg">
      <div class="mb-2 flex items-center justify-between gap-3">
        <span class="text-xs font-semibold">运行时</span>
        <span class="text-xs text-muted-foreground">{{ runtimeType }}</span>
      </div>

      <div class="grid grid-cols-3 gap-1 rounded-md bg-muted/35 p-1">
        <button
          v-for="item in runtimeOptions"
          :key="item.value"
          type="button"
          class="h-7 rounded px-2 text-xs font-medium transition-colors"
          :class="
            runtimeType === item.value
              ? 'bg-background text-primary shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          "
          :disabled="disabled"
          @click="pickRuntime(item.value)">
          {{ item.label }}
        </button>
      </div>

      <div class="mt-3 space-y-1.5">
        <button
          type="button"
          class="flex h-8 w-full items-center justify-between rounded-md px-2 text-xs transition-colors hover:bg-muted/45"
          :disabled="disabled"
          @click="toggleAsr">
          <span class="flex items-center gap-2">
            <span class="i-carbon-microphone inline-block h-3.5 w-3.5" />
            <span>ASR 输入</span>
          </span>
          <span
            class="relative inline-flex h-4 w-7 items-center rounded-full transition-colors"
            :class="asrEnabled ? 'bg-primary' : 'bg-muted-foreground/25'">
            <span
              class="inline-block h-3 w-3 rounded-full bg-background transition-transform"
              :class="asrEnabled ? 'translate-x-3.5' : 'translate-x-0.5'" />
          </span>
        </button>

        <button
          type="button"
          class="flex h-8 w-full items-center justify-between rounded-md px-2 text-xs transition-colors hover:bg-muted/45"
          :disabled="disabled"
          @click="toggleTts">
          <span class="flex items-center gap-2">
            <span class="i-carbon-volume-up inline-block h-3.5 w-3.5" />
            <span>TTS 输出</span>
          </span>
          <span
            class="relative inline-flex h-4 w-7 items-center rounded-full transition-colors"
            :class="ttsEnabled ? 'bg-primary' : 'bg-muted-foreground/25'">
            <span
              class="inline-block h-3 w-3 rounded-full bg-background transition-transform"
              :class="ttsEnabled ? 'translate-x-3.5' : 'translate-x-0.5'" />
          </span>
        </button>
      </div>
    </div>
  </div>
</template>
