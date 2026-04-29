<script setup lang="ts">
/**
 * ThinkingToggle — 思维链开关（紧凑型）
 */
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    disabled?: boolean;
  }>(),
  { disabled: false }
);

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const isEnabled = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
});

function toggle(): void {
  if (props.disabled) return;
  isEnabled.value = !isEnabled.value;
}
</script>

<template>
  <button
    type="button"
    class="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
    :class="isEnabled ? 'text-primary hover:bg-primary/10 hover:text-primary' : ''"
    :disabled="disabled"
    :title="isEnabled ? '思维链已启用' : '思维链已关闭'"
    :aria-label="isEnabled ? '思维链已启用' : '思维链已关闭'"
    @click="toggle">
    <span class="inline-block h-3.5 w-3.5" :class="isEnabled ? 'i-carbon-phrase-sentiment' : 'i-carbon-idea'" />
  </button>
</template>
