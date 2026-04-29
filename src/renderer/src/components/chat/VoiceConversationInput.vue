<script setup lang="ts">
/**
 * VoiceConversationInput — 语音对话模式输入区。
 *
 * 不提供普通文本输入；ASR 识别文本通过 send 事件交给父组件。
 * 录音与 ASR 逻辑由 useAudioRecorder composable 提供。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useWorkerStore } from '@/stores/worker';
import { useAudioRecorder } from '@/composables/useAudioRecorder';

const props = withDefaults(
  defineProps<{
    disabled?: boolean;
    showStopButton?: boolean;
    ttsEnabled?: boolean;
  }>(),
  {
    disabled: false,
    showStopButton: false,
    ttsEnabled: false
  }
);

const emit = defineEmits<{
  send: [data: { text: string; files: { path: string; name: string }[] }];
  stop: [];
}>();

const workerStore = useWorkerStore();

const rootRef = ref<HTMLElement | null>(null);
const partialText = ref('');
const micError = ref('');
const voiceLevel = ref(0);
const recordingStartedAt = ref<number | null>(null);
const recordingDurationMs = ref(0);
let recordingTimer: ReturnType<typeof setInterval> | null = null;

// ==================== ASR 录音 Composable ====================

const MIN_EFFECTIVE_CHARS = 4;

function countEffectiveChars(text: string): number {
  const matches = text.match(/[\u4e00-\u9fff\u3400-\u4dbfa-zA-Z0-9]/g);
  return matches ? matches.length : 0;
}

function trySendOrQueue(text: string): void {
  const cleaned = text.trim();
  if (!cleaned || countEffectiveChars(cleaned) < MIN_EFFECTIVE_CHARS) return;
  if (props.disabled) return;
  emit('send', { text: cleaned, files: [] });
}

const recorder = useAudioRecorder({
  onPartialResult: (text) => {
    partialText.value = text;
  },
  onFinalResult: (text) => {
    if (text) {
      partialText.value = '';
      trySendOrQueue(text);
    }
  },
  onVolumeChange: (vol) => {
    // composable 返回 0-100，转为 0-1 并带平滑衰减
    const nextLevel = Math.min(1, vol / 100);
    voiceLevel.value = Math.max(nextLevel, voiceLevel.value * 0.72);
  },
  onSilence: () => {
    // 客户端 text-idle 检测：partial 文本稳定超时 → 提交
    if (partialText.value.trim()) {
      const text = partialText.value.trim();
      partialText.value = '';
      trySendOrQueue(text);
    }
  }
});

const asrWorker = computed(() => workerStore.getWorker(workerStore.asrWorkerName));
const asrReady = computed(() => asrWorker.value?.status === 'ready');
const canListen = computed(() => asrReady.value && !props.disabled);
const canToggleMute = computed(() => recorder.isRecording.value && !props.disabled);
const canStartWorker = computed(() => {
  const status = asrWorker.value?.status;
  return !props.disabled && (!status || status === 'stopped' || status === 'error');
});

const statusTone = computed<'idle' | 'listening' | 'muted' | 'warning' | 'error'>(() => {
  if (micError.value) return 'error';
  if (!asrWorker.value || canStartWorker.value) return 'warning';
  if (recorder.isRecording.value && recorder.isMuted.value) return 'muted';
  if (recorder.isRecording.value) return 'listening';
  return 'idle';
});

const statusTitle = computed(() => {
  if (props.showStopButton) return '正在等待回复';
  if (micError.value) return '麦克风不可用';
  if (!asrWorker.value) return '未找到 ASR Worker';
  if (canStartWorker.value) return 'ASR 未启动';
  if (asrWorker.value.status !== 'ready') return getStatusLabel(asrWorker.value.status);
  if (recorder.isMuted.value) return '语音已暂停';
  if (recorder.isRecording.value) return '正在聆听';
  if (recorder.isConnected.value) return '正在连接麦克风';
  return '语音对话';
});

const statusDetail = computed(() => {
  if (micError.value) return micError.value;
  if (!asrWorker.value) return '请先在 Worker 设置中启用 ASR';
  if (canStartWorker.value) return '启动后会自动进入聆听状态';
  if (props.showStopButton) return '当前回复完成后继续聆听';
  if (asrWorker.value.status !== 'ready') return '语音服务准备中';
  if (recorder.isMuted.value) return '麦克风已暂停';
  if (partialText.value) return '识别中';
  if (recorder.isRecording.value) return '说话后会自动发送识别结果';
  return '正在准备语音输入';
});

const primaryActionLabel = computed(() => {
  if (!asrWorker.value) return '刷新';
  if (asrWorker.value.status === 'error') return '重试';
  return '启动';
});

const showRecordingMeter = computed(() => recorder.isRecording.value || recorder.isMuted.value);
const recordingDurationLabel = computed(() => {
  const totalSeconds = Math.floor(recordingDurationMs.value / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
});
const waveBars = computed(() => {
  const level = recorder.isRecording.value && !recorder.isMuted.value ? voiceLevel.value : 0;
  const weights = [0.35, 0.58, 0.82, 1, 0.76, 0.52, 0.38];

  return weights.map((weight, index) => {
    const activity = Math.max(
      0.12,
      Math.min(1, level * weight + (recorder.isRecording.value && !recorder.isMuted.value ? 0.18 : 0))
    );
    return {
      height: `${Math.round(6 + activity * 21)}px`,
      opacity: `${0.34 + activity * 0.56}`,
      transitionDelay: `${index * 12}ms`
    };
  });
});

function focus(): void {
  rootRef.value?.focus();
}

defineExpose({
  focus
});

// ==================== 生命周期 ====================

onMounted(() => {
  void workerStore.requestWorkers();
});

onUnmounted(() => {
  recorder.disconnect();
  stopRecordingTimer();
});

// ==================== ASR Worker 就绪 → 自动连接 ====================

watch(
  () => [canListen.value, asrWorker.value?.port] as const,
  ([ready]) => {
    if (ready) {
      recorder
        .connect()
        .then(() => startListening())
        .catch((err) => {
          micError.value = err instanceof Error ? err.message : String(err);
        });
    } else {
      recorder.disconnect();
      stopRecordingTimer();
    }
  },
  { immediate: true }
);

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) {
      recorder.mute();
      partialText.value = '';
    } else {
      // 大模型回复完成，自动恢复麦克风
      recorder.unmute();
    }
  }
);

// ==================== 交互 ====================

async function startCurrentAsrWorker(): Promise<void> {
  if (props.disabled) return;

  if (!asrWorker.value) {
    await workerStore.requestWorkers();
    return;
  }

  if (canStartWorker.value) {
    await workerStore.startWorker(asrWorker.value.name);
  }
}

async function startListening(): Promise<void> {
  if (recorder.isRecording.value || props.disabled) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    micError.value = '当前环境不支持麦克风输入';
    return;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter((device) => device.kind === 'audioinput');

    if (audioInputs.length === 0) {
      micError.value = '未检测到麦克风';
      return;
    }

    await recorder.startRecording();
    micError.value = '';
    startRecordingTimer();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    micError.value =
      message.includes('denied') || message.includes('NotAllowed') ? '麦克风权限被拒绝' : `麦克风不可用：${message}`;
  }
}

function toggleMute(): void {
  if (!canToggleMute.value) return;

  if (recorder.isMuted.value) {
    recorder.unmute();
  } else {
    recorder.mute();
    partialText.value = '';
    voiceLevel.value = 0;
  }
}

// ==================== 录音计时器 ====================

function startRecordingTimer(): void {
  recordingStartedAt.value = Date.now();
  recordingDurationMs.value = 0;

  if (recordingTimer) {
    clearInterval(recordingTimer);
  }

  recordingTimer = setInterval(() => {
    if (recordingStartedAt.value) {
      recordingDurationMs.value = Date.now() - recordingStartedAt.value;
    }
  }, 500);
}

function stopRecordingTimer(): void {
  if (recordingTimer) {
    clearInterval(recordingTimer);
    recordingTimer = null;
  }

  recordingStartedAt.value = null;
  recordingDurationMs.value = 0;
}

// ==================== 工具 ====================

function getStatusLabel(status: string): string {
  switch (status) {
    case 'stopped':
      return 'ASR 已停止';
    case 'initializing':
      return 'ASR 初始化中';
    case 'starting':
      return 'ASR 启动中';
    case 'stopping':
      return 'ASR 停止中';
    case 'error':
      return 'ASR 异常';
    default:
      return status;
  }
}
</script>

<template>
  <div ref="rootRef" class="voice-input-wrapper" tabindex="-1">
    <div class="voice-input-main" :class="`voice-input-main--${statusTone}`">
      <button
        type="button"
        class="voice-orb"
        :class="{ 'voice-orb--listening': recorder.isRecording.value && !recorder.isMuted.value }"
        :disabled="!canToggleMute"
        :title="recorder.isMuted.value ? '继续聆听' : '暂停聆听'"
        :aria-label="recorder.isMuted.value ? '继续聆听' : '暂停聆听'"
        @click="toggleMute">
        <span class="voice-orb-ring" />
        <span
          class="inline-block h-5 w-5"
          :class="
            recorder.isMuted.value || !recorder.isRecording.value
              ? 'i-carbon-microphone-off'
              : 'i-carbon-microphone-filled'
          " />
      </button>

      <div class="voice-state">
        <div class="voice-state-head">
          <span class="voice-status-dot" />
          <span class="voice-title">{{ statusTitle }}</span>
          <span v-if="ttsEnabled" class="voice-pill">
            <span class="i-carbon-volume-up inline-block h-3 w-3" />
            <span>TTS</span>
          </span>
        </div>
        <p class="voice-detail" :class="{ 'voice-detail--error': statusTone === 'error' }">{{ statusDetail }}</p>
        <div
          v-if="showRecordingMeter"
          class="voice-meter-row"
          :class="{ 'voice-meter-row--muted': recorder.isMuted.value }">
          <div class="voice-wave" aria-hidden="true">
            <span v-for="(bar, index) in waveBars" :key="index" class="voice-wave-bar" :style="bar" />
          </div>
          <span class="voice-duration">{{ recordingDurationLabel }}</span>
          <span v-if="recorder.isMuted.value" class="voice-meter-label">暂停</span>
        </div>
        <div v-if="partialText" class="voice-partial">
          <span class="i-carbon-circle-dash inline-block h-3.5 w-3.5" />
          <span>{{ partialText }}</span>
        </div>
      </div>

      <button
        v-if="canStartWorker"
        type="button"
        class="voice-primary-action"
        :disabled="disabled"
        @click="startCurrentAsrWorker">
        <span class="i-carbon-play-filled inline-block h-3.5 w-3.5" />
        <span>{{ primaryActionLabel }}</span>
      </button>
    </div>

    <div class="voice-input-toolbar">
      <div class="toolbar-left">
        <slot name="toolbar-left" />
      </div>

      <div class="toolbar-right">
        <button
          v-if="showStopButton"
          type="button"
          class="toolbar-btn toolbar-btn-stop"
          title="中断"
          @click="emit('stop')">
          <span class="i-carbon-stop-filled inline-block h-3.5 w-3.5" />
        </button>
        <button
          v-else
          type="button"
          class="toolbar-btn"
          :class="recorder.isMuted.value ? 'toolbar-btn-voice-muted' : 'toolbar-btn-voice'"
          :disabled="!canToggleMute"
          :title="recorder.isMuted.value ? '继续聆听' : '暂停聆听'"
          @click="toggleMute">
          <span
            class="inline-block h-3.5 w-3.5"
            :class="recorder.isMuted.value ? 'i-carbon-microphone-off' : 'i-carbon-pause-filled'" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.voice-input-wrapper {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 112px;
  overflow: visible;
  border: 1px solid hsl(var(--border) / 0.45);
  border-radius: 10px;
  background: hsl(var(--background));
  outline: none;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease;
}

.voice-input-wrapper:focus-within {
  border-color: hsl(var(--primary) / 0.4);
}

.voice-input-main {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 70px;
  padding: 12px 13px 45px;
  color: hsl(var(--foreground));
}

.voice-orb {
  position: relative;
  display: inline-flex;
  width: 46px;
  height: 46px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid hsl(var(--border) / 0.55);
  border-radius: 999px;
  background: hsl(var(--muted) / 0.38);
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  outline: none;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease,
    color 0.15s ease;
}

.voice-orb:disabled {
  cursor: not-allowed;
  opacity: 0.72;
}

.voice-orb:not(:disabled):hover,
.voice-orb:focus-visible {
  border-color: hsl(var(--primary) / 0.38);
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}

.voice-orb-ring {
  position: absolute;
  inset: -4px;
  border: 1px solid transparent;
  border-radius: inherit;
  pointer-events: none;
}

.voice-orb--listening {
  border-color: hsl(var(--primary) / 0.42);
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}

.voice-orb--listening .voice-orb-ring {
  border-color: hsl(var(--primary) / 0.22);
  animation: voice-pulse 1.4s ease-out infinite;
}

.voice-state {
  min-width: 0;
  flex: 1;
}

.voice-state-head {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
}

.voice-status-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: 999px;
  background: hsl(var(--muted-foreground) / 0.38);
}

.voice-input-main--listening .voice-status-dot {
  background: hsl(var(--primary));
  box-shadow: 0 0 0 4px hsl(var(--primary) / 0.12);
}

.voice-input-main--muted .voice-status-dot,
.voice-input-main--warning .voice-status-dot {
  background: hsl(var(--warning));
}

.voice-input-main--error .voice-status-dot {
  background: hsl(var(--error));
}

.voice-title {
  min-width: 0;
  overflow: hidden;
  color: hsl(var(--foreground));
  font-size: 13px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.voice-pill {
  display: inline-flex;
  height: 20px;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  border-radius: 999px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
  font-size: 11px;
  font-weight: 600;
  padding: 0 7px;
}

.voice-detail {
  min-height: 18px;
  margin: 3px 0 0;
  overflow: hidden;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.voice-detail--error {
  color: hsl(var(--error));
}

.voice-meter-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  margin-top: 7px;
}

.voice-wave {
  display: inline-flex;
  height: 28px;
  align-items: center;
  gap: 3px;
  color: hsl(var(--primary));
}

.voice-wave-bar {
  display: inline-block;
  width: 3px;
  min-height: 5px;
  border-radius: 999px;
  background: currentColor;
  transition:
    height 0.12s ease,
    opacity 0.12s ease;
}

.voice-meter-row--muted .voice-wave {
  color: hsl(var(--warning));
}

.voice-duration {
  min-width: 34px;
  color: hsl(var(--muted-foreground));
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.voice-meter-label {
  display: inline-flex;
  height: 20px;
  align-items: center;
  border-radius: 999px;
  background: hsl(var(--warning) / 0.12);
  color: hsl(var(--warning));
  font-size: 11px;
  font-weight: 600;
  padding: 0 7px;
}

.voice-partial {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  margin-top: 8px;
  padding: 5px 8px;
  border: 1px solid hsl(var(--primary) / 0.12);
  border-radius: 7px;
  background: hsl(var(--primary) / 0.06);
  color: hsl(var(--primary));
  font-size: 12px;
  line-height: 1.4;
}

.voice-partial span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.voice-primary-action {
  display: inline-flex;
  height: 30px;
  flex-shrink: 0;
  align-items: center;
  gap: 5px;
  border: none;
  border-radius: 7px;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  padding: 0 10px;
  outline: none;
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.voice-primary-action:hover:not(:disabled) {
  transform: translateY(-1px);
}

.voice-primary-action:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.voice-input-toolbar {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 10px;
  border-top: 1px solid hsl(var(--border) / 0.14);
  background: transparent;
}

.toolbar-left {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 4px;
}

.toolbar-right {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
}

.toolbar-btn {
  display: flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  outline: none;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.toolbar-btn:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.toolbar-btn-stop {
  background: transparent;
  color: hsl(var(--error));
}

.toolbar-btn-stop:hover {
  background: hsl(var(--error) / 0.1);
}

.toolbar-btn-voice {
  background: transparent;
  color: hsl(var(--primary));
}

.toolbar-btn-voice:hover:not(:disabled) {
  background: hsl(var(--primary) / 0.1);
}

.toolbar-btn-voice-muted {
  background: transparent;
  color: hsl(var(--warning));
}

.toolbar-btn-voice-muted:hover:not(:disabled) {
  background: hsl(var(--warning) / 0.12);
}

@keyframes voice-pulse {
  0% {
    opacity: 0.75;
    transform: scale(0.96);
  }

  100% {
    opacity: 0;
    transform: scale(1.18);
  }
}

@media (prefers-color-scheme: dark) {
  .voice-input-wrapper {
    background: hsl(var(--surface) / 0.25);
    border-color: hsl(var(--border) / 0.35);
  }
}

@media (max-width: 560px) {
  .voice-input-main {
    gap: 10px;
    padding-right: 10px;
    padding-left: 10px;
  }

  .voice-orb {
    width: 42px;
    height: 42px;
  }

  .voice-primary-action span:last-child {
    display: none;
  }
}
</style>
