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
    class="thinking-toggle"
    :class="{ 'thinking-toggle--active': isEnabled }"
    :disabled="disabled"
    :title="isEnabled ? '思维链已启用' : '思维链已关闭'"
    @click="toggle">
    <span class="thinking-toggle-icon" :class="isEnabled ? 'i-carbon-phrase-sentiment' : 'i-carbon-tools'" />
    <span class="thinking-toggle-label">思维链</span>
  </button>
</template>

<style scoped>
.thinking-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
  border: 1px solid hsl(var(--border) / 0.25);
  background: transparent;
  color: hsl(var(--muted-foreground) / 0.85);
  transition: all 0.15s ease;
  cursor: pointer;
  white-space: nowrap;
}

.thinking-toggle:hover:not(:disabled) {
  background: hsl(var(--muted) / 0.5);
  border-color: hsl(var(--border) / 0.5);
  color: hsl(var(--foreground));
}

.thinking-toggle--active {
  background: hsl(var(--primary) / 0.1);
  border-color: hsl(var(--primary) / 0.3);
  color: hsl(var(--primary));
}

.thinking-toggle--active:hover:not(:disabled) {
  background: hsl(var(--primary) / 0.15);
  border-color: hsl(var(--primary) / 0.4);
}

.thinking-toggle:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.thinking-toggle-icon {
  display: inline-block;
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}

.thinking-toggle-label {
  line-height: 1;
}
</style>
