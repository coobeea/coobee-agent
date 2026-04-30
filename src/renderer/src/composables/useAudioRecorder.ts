/**
 * useAudioRecorder — 语音录音与 ASR 识别 Composable
 *
 * 封装麦克风采集、PCM 降采样、WebSocket 传输、ASR 结果消费全链路。
 *
 * 核心机制：
 *   1. 音频采集：ScriptProcessorNode → Float32 → 累计若干采集帧 → 降采样 16kHz → Int16 → WebSocket
 *   2. 服务端 VAD：Python ASR 服务端检测停顿后触发识别，返回 partial/final
 *   3. 客户端 text-idle：partial 文本稳定超过 SILENCE_DURATION 后触发结束回调
 */

import { ref } from 'vue';
import { useWorkerStore } from '@/stores/worker';
import configManager from '@/config';

// ==================== 类型 ====================

export interface AsrMeta {
  lang?: string | null;
  emotion?: string | null;
  event?: string | null;
}

export type AsrStatus = 'speech_start' | 'speech_active' | 'speech_end' | 'recognizing' | 'recognized';

export interface AsrStatusPayload {
  status: AsrStatus | string;
  bufferedMs?: number;
  latencyMs?: number;
  textTail?: string;
  energy?: number;
}

export interface AudioRecorderOptions {
  /** ASR partial 结果回调（实时识别中间结果） */
  onPartialResult?: (text: string, meta?: AsrMeta) => void;
  /** ASR final 结果回调（断连时最终结果） */
  onFinalResult?: (text: string, meta?: AsrMeta) => void;
  /** ASR 服务端处理状态回调 */
  onStatus?: (payload: AsrStatusPayload) => void;
  /** 音量变化回调，0-100 */
  onVolumeChange?: (volume: number) => void;
  /** 客户端检测到文本闲置（说话结束）回调 */
  onSilence?: () => void;
  /** 前端 VAD 阈值（0.0-1.0），默认 0.02 */
  vadThreshold?: number;
  /** 文本闲置判定时长（毫秒），默认 10000 */
  silenceDuration?: number;
  /** 前端检测到语音后保持 speaking 的时长（毫秒），默认 1200 */
  speechHoldDuration?: number;
  /** 音频累计满多少个采集帧后发送，默认 5 */
  framesPerFlush?: number;
}

export interface UseAudioRecorderReturn {
  isConnected: import('vue').Ref<boolean>;
  isRecording: import('vue').Ref<boolean>;
  isSpeaking: import('vue').Ref<boolean>;
  isMuted: import('vue').Ref<boolean>;
  /** 连接 ASR WebSocket */
  connect: () => Promise<void>;
  /** 开始录音（需要先 connect） */
  startRecording: () => Promise<void>;
  /** 停止录音 */
  stopRecording: () => void;
  /** 断开连接 */
  disconnect: () => void;
  /** 重置已发送文本偏移量（新对话轮次时调用） */
  resetSentOffset: () => void;
  /** 静音（暂停发送音频、暂停识别回调） */
  mute: () => void;
  /** 取消静音 */
  unmute: () => void;
}

// ==================== 实现 ====================

export function useAudioRecorder(options: AudioRecorderOptions = {}): UseAudioRecorderReturn {
  const workerStore = useWorkerStore();

  const isConnected = ref(false);
  const isRecording = ref(false);
  const isSpeaking = ref(false);
  const isMuted = ref(false);

  let ws: WebSocket | null = null;
  let audioContext: AudioContext | null = null;
  let mediaStream: MediaStream | null = null;
  let processor: ScriptProcessorNode | null = null;
  let sourceNode: MediaStreamAudioSourceNode | null = null;

  let pcmSendBuffer: Float32Array[] = [];
  let sendTimer: number | null = null;
  let silenceTimer: number | null = null;
  let textIdleTimer: number | null = null;

  const PROCESSOR_BUFFER_SIZE = 4096;
  const FLUSH_FALLBACK_INTERVAL = 600;
  const FRAMES_PER_FLUSH = Math.max(1, Math.floor(options.framesPerFlush ?? 5));
  const VAD_THRESHOLD = options.vadThreshold || 0.02;
  const SILENCE_DURATION = options.silenceDuration || 10000;
  const SPEECH_HOLD_DURATION = options.speechHoldDuration || 1200;

  let sentTextLength = 0;
  let lastKnownFullText = '';
  let prevPartialText = '';

  // ==================== 工具方法 ====================

  const resetSentOffset = (): void => {
    sentTextLength = lastKnownFullText.length;
    prevPartialText = '';
  };

  function downsample(samples: Float32Array, inputRate: number, outputRate: number): Float32Array {
    if (inputRate === outputRate) return samples;

    const ratio = inputRate / outputRate;
    const intRatio = Math.round(ratio);

    if (Math.abs(ratio - intRatio) < 0.01 && intRatio >= 2) {
      const newLen = Math.floor(samples.length / intRatio);
      const result = new Float32Array(newLen);
      for (let i = 0; i < newLen; i++) {
        let sum = 0;
        const base = i * intRatio;
        for (let j = 0; j < intRatio; j++) {
          sum += samples[base + j];
        }
        result[i] = sum / intRatio;
      }
      return result;
    }

    const newLen = Math.round(samples.length / ratio);
    const result = new Float32Array(newLen);
    const windowHalf = Math.ceil(ratio / 2);
    for (let i = 0; i < newLen; i++) {
      const center = i * ratio;
      const lo = Math.max(0, Math.floor(center) - windowHalf);
      const hi = Math.min(samples.length - 1, Math.floor(center) + windowHalf);
      let sum = 0;
      for (let j = lo; j <= hi; j++) {
        sum += samples[j];
      }
      result[i] = sum / (hi - lo + 1);
    }
    return result;
  }

  function float32ToInt16(float32: Float32Array): ArrayBuffer {
    const buf = new ArrayBuffer(float32.length * 2);
    const view = new DataView(buf);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buf;
  }

  // ==================== WebSocket ====================

  const connect = async (): Promise<void> => {
    if (ws && ws.readyState === WebSocket.OPEN) return;

    // 确保 ASR Worker 就绪
    if (!workerStore.asrReady) {
      await workerStore.requestWorkers();
      if (!workerStore.asrReady) {
        throw new Error('ASR Worker not ready');
      }
    }

    const url = configManager.getWorkerProxyWsUrl(workerStore.asrWorkerName, '/ws/asr');
    ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      isConnected.value = true;
    };

    ws.onmessage = (event) => {
      handleASRMessage(event.data);
    };

    ws.onclose = () => {
      isConnected.value = false;
      stopRecording();
    };

    ws.onerror = () => {
      isConnected.value = false;
    };
  };

  function handleASRMessage(rawData: unknown): void {
    try {
      const data = JSON.parse(String(rawData)) as Record<string, unknown>;

      // 忽略连接准备状态，ASR 处理状态由 asr_status 单独透传。
      if (data.status === 'loading' || data.status === 'ready') return;

      const partial = typeof data.partial === 'string' ? data.partial : '';
      const finalText = typeof data.final === 'string' ? data.final.trim() : '';
      const asrStatus = typeof data.asr_status === 'string' ? data.asr_status : '';
      const meta: AsrMeta = {
        lang: typeof data.lang === 'string' ? data.lang : null,
        emotion: typeof data.emotion === 'string' ? data.emotion : null,
        event: typeof data.event === 'string' ? data.event : null
      };

      if (asrStatus && !isMuted.value) {
        options.onStatus?.({
          status: asrStatus,
          bufferedMs: typeof data.buffered_ms === 'number' ? data.buffered_ms : undefined,
          latencyMs: typeof data.latency_ms === 'number' ? data.latency_ms : undefined,
          textTail: typeof data.text_tail === 'string' ? data.text_tail : undefined,
          energy: typeof data.energy === 'number' ? data.energy : undefined
        });
      }

      if (partial) {
        lastKnownFullText = partial;
        const currentTurnText = partial.substring(sentTextLength);
        if (currentTurnText.trim() && !isMuted.value) {
          options.onPartialResult?.(currentTurnText, meta);

          // 文本有变化 → 重置闲置计时器
          if (currentTurnText !== prevPartialText) {
            prevPartialText = currentTurnText;
            resetTextIdleTimer();
          }
        }
      }

      if (finalText) {
        const currentTurnText = finalText.substring(sentTextLength);
        if (currentTurnText.trim() && !isMuted.value) {
          options.onFinalResult?.(currentTurnText, meta);
        }
      }
    } catch {
      // 忽略非 JSON 消息
    }
  }

  // ==================== 文本闲置检测 ====================

  function resetTextIdleTimer(): void {
    if (textIdleTimer) clearTimeout(textIdleTimer);
    textIdleTimer = window.setTimeout(() => {
      if (prevPartialText.trim() && !isMuted.value) {
        options.onSilence?.();
      }
    }, SILENCE_DURATION);
  }

  // ==================== 录音与 VAD ====================

  function flushBuffer(): void {
    if (!ws || ws.readyState !== WebSocket.OPEN || pcmSendBuffer.length === 0 || !audioContext) return;

    let totalLen = 0;
    for (const chunk of pcmSendBuffer) totalLen += chunk.length;
    const merged = new Float32Array(totalLen);
    let offset = 0;
    for (const chunk of pcmSendBuffer) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    pcmSendBuffer = [];

    const finalSamples = downsample(merged, audioContext.sampleRate, 16000);
    ws.send(float32ToInt16(finalSamples));
  }

  const startRecording = async (): Promise<void> => {
    if (isRecording.value) return;
    if (!isConnected.value) await connect();

    // 获取麦克风
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    audioContext = new AudioContext();
    sourceNode = audioContext.createMediaStreamSource(mediaStream);
    processor = audioContext.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);

    processor.onaudioprocess = (e) => {
      if (!isRecording.value) return;
      const samples = e.inputBuffer.getChannelData(0);

      // 静音时跳过缓冲和发送，避免向云端发送无用数据（计费）
      if (isMuted.value) {
        options.onVolumeChange?.(0);
        e.outputBuffer.getChannelData(0).fill(0);
        return;
      }

      // 前端 VAD：计算峰值
      let maxVal = 0;
      for (let i = 0; i < samples.length; i += 32) {
        const v = Math.abs(samples[i]);
        if (v > maxVal) maxVal = v;
      }

      options.onVolumeChange?.(maxVal * 100);
      if (maxVal > VAD_THRESHOLD) {
        if (!isSpeaking.value) isSpeaking.value = true;
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = window.setTimeout(() => {
          isSpeaking.value = false;
        }, SPEECH_HOLD_DURATION);
      }

      // 缓存 PCM 数据
      pcmSendBuffer.push(new Float32Array(samples));
      if (pcmSendBuffer.length >= FRAMES_PER_FLUSH) {
        flushBuffer();
      }

      // 静音时清空输出，避免回声
      e.outputBuffer.getChannelData(0).fill(0);
    };

    sourceNode.connect(processor);
    processor.connect(audioContext.destination);

    sendTimer = window.setInterval(flushBuffer, FLUSH_FALLBACK_INTERVAL);
    isRecording.value = true;
  };

  const stopRecording = (): void => {
    isRecording.value = false;
    isSpeaking.value = false;

    if (sendTimer) {
      clearInterval(sendTimer);
      sendTimer = null;
    }
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
    if (textIdleTimer) {
      clearTimeout(textIdleTimer);
      textIdleTimer = null;
    }

    flushBuffer();
    pcmSendBuffer = [];

    if (processor) {
      processor.disconnect();
      processor = null;
    }
    if (sourceNode) {
      sourceNode.disconnect();
      sourceNode = null;
    }
    if (audioContext) {
      audioContext.close().catch(() => {});
      audioContext = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }
  };

  const mute = (): void => {
    isMuted.value = true;
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
    if (textIdleTimer) {
      clearTimeout(textIdleTimer);
      textIdleTimer = null;
    }
    isSpeaking.value = false;
  };

  const unmute = (): void => {
    isMuted.value = false;
    sentTextLength = lastKnownFullText.length;
    prevPartialText = '';
  };

  const disconnect = (): void => {
    stopRecording();
    if (ws) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      ws = null;
    }
    isConnected.value = false;
  };

  return {
    isConnected,
    isRecording,
    isSpeaking,
    isMuted,
    connect,
    startRecording,
    stopRecording,
    disconnect,
    resetSentOffset,
    mute,
    unmute
  };
}
