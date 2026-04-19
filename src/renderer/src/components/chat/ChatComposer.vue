<script setup lang="ts">
/**
 * ChatComposer — 任务对话输入区（可复用）
 *
 * 组合：模型选择（当前 Thread 的 overrideModel）+ ChatInput（Tiptap）。
 */
import { ref, computed, onMounted, watch } from 'vue';
import { useThreadsStore } from '@/stores/threads';
import { useAgentsStore } from '@/stores/agents';
import { useFlatConfigModels } from '@/composables/useFlatConfigModels';
import ChatInput from '@/components/chat/ChatInput.vue';
import ModelPickerDropdown from '@/components/chat/ModelPickerDropdown.vue';
import ThinkingToggle from '@/components/chat/ThinkingToggle.vue';
import { getDefaultModel } from '@/api/config';

const props = withDefaults(
  defineProps<{
    threadId: string;
    placeholder?: string;
    disabled?: boolean;
    showStopButton?: boolean;
    /** 是否显示任务级模型覆盖选择 */
    showModelPicker?: boolean;
  }>(),
  {
    placeholder: '输入消息... (Enter 发送，Shift+Enter 换行)',
    disabled: false,
    showStopButton: false,
    showModelPicker: true
  }
);

const emit = defineEmits<{
  send: [data: { text: string; files: { path: string; name: string }[] }];
  stop: [];
}>();

const threadsStore = useThreadsStore();
const agentsStore = useAgentsStore();
const { flatModelList, loadFlatModels } = useFlatConfigModels();
const defaultModelSpec = ref('');

const inputRef = ref<InstanceType<typeof ChatInput> | null>(null);

const currentThread = computed(() => threadsStore.threads.find((x) => x.id === props.threadId));
const currentAgent = computed(() => agentsStore.agents.find((a) => a.id === currentThread.value?.agentId));

const selectedModel = computed(() => {
  return currentThread.value?.overrideModel || currentAgent.value?.model || defaultModelSpec.value || '';
});

const enableThinking = computed({
  get: () => {
    const t = threadsStore.threads.find((x) => x.id === props.threadId);
    return t?.enableThinking ?? false;
  },
  set: async (val: boolean) => {
    try {
      await threadsStore.updateThread(props.threadId, {
        enableThinking: val
      });
    } catch (e) {
      console.error('[ChatComposer] updateThread enableThinking failed:', e);
    }
  }
});

async function onSelectModel(modelValue: string): Promise<void> {
  try {
    await threadsStore.updateThread(props.threadId, {
      overrideModel: modelValue === '' ? null : modelValue
    });
  } catch (e) {
    console.error('[ChatComposer] updateThread model failed:', e);
  }
}

async function loadDefaultModel(): Promise<void> {
  try {
    const result = await getDefaultModel();
    if (result.success && result.data?.modelId) {
      defaultModelSpec.value = result.data.modelId;
    }
  } catch (e) {
    console.warn('[ChatComposer] loadDefaultModel failed:', e);
  }
}

onMounted(() => {
  void loadFlatModels();
  void loadDefaultModel();
  if (agentsStore.agents.length === 0) {
    void agentsStore.fetchAgents();
  }
});

watch(
  () => props.threadId,
  () => {
    void loadFlatModels();
  }
);

function insertFileReference(file: { path: string; name: string }): void {
  inputRef.value?.insertFileReference(file);
}

function focusInput(): void {
  inputRef.value?.focus();
}

defineExpose({
  insertFileReference,
  focus: focusInput
});
</script>

<template>
  <ChatInput
    ref="inputRef"
    :placeholder="placeholder"
    :disabled="disabled"
    :show-stop-button="showStopButton"
    @send="emit('send', $event)"
    @stop="emit('stop')">
    <!-- 左下角：模型选择器 + 思维链开关（slot） -->
    <template v-if="showModelPicker" #toolbar-left>
      <ModelPickerDropdown
        :items="flatModelList"
        :selected-value="selectedModel"
        :disabled="disabled"
        @select="onSelectModel" />
      <ThinkingToggle v-model="enableThinking" :disabled="disabled" />
    </template>
  </ChatInput>
</template>
