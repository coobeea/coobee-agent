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
import ThreadRunSettings from '@/components/chat/ThreadRunSettings.vue';
import ContextUsageIndicator from '@/components/chat/ContextUsageIndicator.vue';
import VoiceConversationInput from '@/components/chat/VoiceConversationInput.vue';
import { getDefaultModel } from '@/api/config';
import type { ExecutionStats } from '@/types/chat';
import type { ThreadRuntimeType } from '@shared/events/thread';

const props = withDefaults(
  defineProps<{
    threadId: string;
    placeholder?: string;
    disabled?: boolean;
    showStopButton?: boolean;
    /** 是否显示任务级模型覆盖选择 */
    showModelPicker?: boolean;
    /** 最近一次模型调用的上下文使用统计 */
    contextStats?: ExecutionStats;
  }>(),
  {
    placeholder: '输入消息... (Enter 发送，Shift+Enter 换行)',
    disabled: false,
    showStopButton: false,
    showModelPicker: true,
    contextStats: undefined
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

const textInputRef = ref<InstanceType<typeof ChatInput> | null>(null);
const voiceInputRef = ref<InstanceType<typeof VoiceConversationInput> | null>(null);

const currentThread = computed(() => threadsStore.threads.find((x) => x.id === props.threadId));
const currentAgent = computed(() => agentsStore.agents.find((a) => a.id === currentThread.value?.agentId));

const selectedModel = computed(() => {
  return currentThread.value?.overrideModel || currentAgent.value?.model || defaultModelSpec.value || '';
});

const enableThinking = computed({
  get: () => {
    const t = threadsStore.threads.find((x) => x.id === props.threadId);
    return t?.enableThinking ?? currentAgent.value?.enableThinking ?? false;
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

const runtimeType = computed<ThreadRuntimeType>({
  get: () => currentThread.value?.runtimeType ?? currentAgent.value?.runtimeType ?? 'pi-mono',
  set: async (val: ThreadRuntimeType) => {
    try {
      await threadsStore.updateThread(props.threadId, {
        runtimeType: val
      });
    } catch (e) {
      console.error('[ChatComposer] updateThread runtimeType failed:', e);
    }
  }
});

const asrEnabled = computed({
  get: () => currentThread.value?.asrEnabled ?? currentAgent.value?.asrEnabled ?? false,
  set: async (val: boolean) => {
    try {
      await threadsStore.updateThread(props.threadId, {
        asrEnabled: val
      });
    } catch (e) {
      console.error('[ChatComposer] updateThread asrEnabled failed:', e);
    }
  }
});

const ttsEnabled = computed({
  get: () => currentThread.value?.ttsEnabled ?? currentAgent.value?.ttsEnabled ?? false,
  set: async (val: boolean) => {
    try {
      await threadsStore.updateThread(props.threadId, {
        ttsEnabled: val
      });
    } catch (e) {
      console.error('[ChatComposer] updateThread ttsEnabled failed:', e);
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
  if (asrEnabled.value) return;
  textInputRef.value?.insertFileReference(file);
}

function focusInput(): void {
  if (asrEnabled.value) {
    voiceInputRef.value?.focus();
    return;
  }

  textInputRef.value?.focus();
}

defineExpose({
  insertFileReference,
  focus: focusInput
});
</script>

<template>
  <VoiceConversationInput
    v-if="asrEnabled"
    ref="voiceInputRef"
    :disabled="disabled"
    :show-stop-button="showStopButton"
    :tts-enabled="ttsEnabled"
    @send="emit('send', $event)"
    @stop="emit('stop')">
    <template #toolbar-left>
      <ModelPickerDropdown
        v-if="showModelPicker"
        :items="flatModelList"
        :selected-value="selectedModel"
        :disabled="disabled"
        @select="onSelectModel" />
      <ThinkingToggle v-if="showModelPicker" v-model="enableThinking" :disabled="disabled" />
      <ThreadRunSettings
        v-model:runtime-type="runtimeType"
        v-model:asr-enabled="asrEnabled"
        v-model:tts-enabled="ttsEnabled"
        :disabled="disabled" />
      <ContextUsageIndicator :stats="contextStats" />
    </template>
  </VoiceConversationInput>

  <ChatInput
    v-else
    ref="textInputRef"
    :placeholder="placeholder"
    :disabled="disabled"
    :show-stop-button="showStopButton"
    @send="emit('send', $event)"
    @stop="emit('stop')">
    <!-- 左下角：模型选择器 + 思维链开关（slot） -->
    <template #toolbar-left>
      <ModelPickerDropdown
        v-if="showModelPicker"
        :items="flatModelList"
        :selected-value="selectedModel"
        :disabled="disabled"
        @select="onSelectModel" />
      <ThinkingToggle v-if="showModelPicker" v-model="enableThinking" :disabled="disabled" />
      <ThreadRunSettings
        v-model:runtime-type="runtimeType"
        v-model:asr-enabled="asrEnabled"
        v-model:tts-enabled="ttsEnabled"
        :disabled="disabled" />
      <ContextUsageIndicator :stats="contextStats" />
    </template>
  </ChatInput>
</template>
