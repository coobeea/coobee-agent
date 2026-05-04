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

export type AsrTranscriptEvent = 'update' | 'turn_final' | 'session_final';

export interface AsrTranscriptPayload {
  event: AsrTranscriptEvent | string;
  provider?: string | null;
  seq?: number;
  revision?: number;
  turnId?: string | null;
  committedText: string;
  draftText: string;
  displayText: string;
  isTurnFinal: boolean;
  isSessionFinal: boolean;
  bufferedMs?: number;
  latencyMs?: number;
  meta?: AsrMeta;
}

export interface AudioRecorderOptions {
  /** 统一转写协议回调 */
  onTranscriptUpdate?: (payload: AsrTranscriptPayload) => void;
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

  let textOffset = 0;
  let lastKnownDisplayText = '';
  let prevPartialText = '';
  let lastTranscriptSeq = 0;

  function isAsrDebugEnabled(): boolean {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('coobee.asr.debug') === '1';
  }

  function debugAsrLog(event: string, payload?: Record<string, unknown>): void {
    if (!isAsrDebugEnabled()) return;
    if (payload) {
      console.log(`[useAudioRecorder] ${event}`, payload);
      return;
    }
    console.log(`[useAudioRecorder] ${event}`);
  }

  // ==================== 工具方法 ====================

  const resetSentOffset = (): void => {
    textOffset = lastKnownDisplayText.length;
    prevPartialText = '';
  };

  function shouldInsertSpace(before: string, after: string): boolean {
    return /[a-zA-Z0-9]$/.test(before) && /^[a-zA-Z0-9]/.test(after);
  }

  function findTextOverlap(before: string, after: string): number {
    const beforeChars = Array.from(before);
    const afterChars = Array.from(after);
    const maxOverlap = Math.min(beforeChars.length, afterChars.length, 40);

    for (let length = maxOverlap; length > 0; length--) {
      const beforeTail = beforeChars.slice(-length).join('');
      const afterHead = afterChars.slice(0, length).join('');
      if (beforeTail === afterHead) return length;
    }

    return 0;
  }

  function mergeTranscriptText(before: string, after: string): string {
    const base = before.trim();
    const next = after.trim();
    if (!base) return next;
    if (!next || next === base || base.includes(next)) return base;
    if (next.startsWith(base) || next.includes(base)) return next;

    const overlap = findTextOverlap(base, next);
    const nextChars = Array.from(next);
    const separator = overlap === 0 && shouldInsertSpace(base, next) ? ' ' : '';
    return `${base}${separator}${nextChars.slice(overlap).join('')}`;
  }

  function applyTextOffset(text: string): string {
    if (!text) return '';
    if (textOffset <= 0) return text;
    if (textOffset >= text.length) return '';
    return text.substring(textOffset);
  }

  function buildTranscriptPayload(data: Record<string, unknown>, meta: AsrMeta): AsrTranscriptPayload | null {
    const hasUnifiedTranscript =
      typeof data.transcript_event === 'string' ||
      typeof data.committed_text === 'string' ||
      typeof data.draft_text === 'string' ||
      typeof data.display_text === 'string';

    if (!hasUnifiedTranscript) return null;

    const committedText = typeof data.committed_text === 'string' ? data.committed_text : '';
    const draftText = typeof data.draft_text === 'string' ? data.draft_text : '';
    const fullDisplayText =
      typeof data.display_text === 'string' ? data.display_text : mergeTranscriptText(committedText, draftText);
    const visibleCommittedText = applyTextOffset(committedText);
    const visibleDisplayText = applyTextOffset(fullDisplayText);
    const visibleDraftText =
      visibleCommittedText && visibleDisplayText.startsWith(visibleCommittedText)
        ? visibleDisplayText.substring(visibleCommittedText.length)
        : visibleDisplayText;

    lastKnownDisplayText = fullDisplayText;

    return {
      event: typeof data.transcript_event === 'string' ? data.transcript_event : 'update',
      provider: typeof data.provider === 'string' ? data.provider : null,
      seq: typeof data.seq === 'number' ? data.seq : undefined,
      revision: typeof data.revision === 'number' ? data.revision : undefined,
      turnId: typeof data.turn_id === 'string' ? data.turn_id : null,
      committedText: visibleCommittedText,
      draftText: visibleDraftText,
      displayText: visibleDisplayText,
      isTurnFinal: Boolean(data.is_final_turn),
      isSessionFinal: Boolean(data.is_final_session),
      bufferedMs: typeof data.buffered_ms === 'number' ? data.buffered_ms : undefined,
      latencyMs: typeof data.latency_ms === 'number' ? data.latency_ms : undefined,
      meta
    };
  }

  function shouldIgnoreTranscriptPayload(payload: AsrTranscriptPayload): boolean {
    if (typeof payload.seq !== 'number') return false;
    if (payload.seq <= lastTranscriptSeq) return true;
    lastTranscriptSeq = payload.seq;
    return false;
  }

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
      debugAsrLog('ws_open', { url });
    };

    ws.onmessage = (event) => {
      handleASRMessage(event.data);
    };

    ws.onclose = () => {
      isConnected.value = false;
      debugAsrLog('ws_close');
      stopRecording();
    };

    ws.onerror = () => {
      isConnected.value = false;
      debugAsrLog('ws_error');
    };
  };

  function handleASRMessage(rawData: unknown): void {
    try {
      const data = JSON.parse(String(rawData)) as Record<string, unknown>;

      if (data.status === 'loading' || data.status === 'ready') return;

      const asrStatus = typeof data.asr_status === 'string' ? data.asr_status : '';
      const meta: AsrMeta = {
        lang: typeof data.lang === 'string' ? data.lang : null,
        emotion: typeof data.emotion === 'string' ? data.emotion : null,
        event: typeof data.event === 'string' ? data.event : null
      };

      if (asrStatus && !isMuted.value) {
        debugAsrLog('status', {
          status: asrStatus,
          bufferedMs: typeof data.buffered_ms === 'number' ? data.buffered_ms : undefined,
          latencyMs: typeof data.latency_ms === 'number' ? data.latency_ms : undefined,
          textTail: typeof data.text_tail === 'string' ? data.text_tail : undefined
        });
        options.onStatus?.({
          status: asrStatus,
          bufferedMs: typeof data.buffered_ms === 'number' ? data.buffered_ms : undefined,
          latencyMs: typeof data.latency_ms === 'number' ? data.latency_ms : undefined,
          textTail: typeof data.text_tail === 'string' ? data.text_tail : undefined,
          energy: typeof data.energy === 'number' ? data.energy : undefined
        });
      }

      const transcriptPayload = buildTranscriptPayload(data, meta);
      if (transcriptPayload && !isMuted.value) {
        if (shouldIgnoreTranscriptPayload(transcriptPayload)) {
          debugAsrLog('transcript_ignored', {
            seq: transcriptPayload.seq,
            turnId: transcriptPayload.turnId,
            event: transcriptPayload.event
          });
          return;
        }

        debugAsrLog('transcript', {
          seq: transcriptPayload.seq,
          turnId: transcriptPayload.turnId,
          event: transcriptPayload.event,
          committedLength: transcriptPayload.committedText.length,
          draftLength: transcriptPayload.draftText.length,
          displayLength: transcriptPayload.displayText.length
        });
        options.onTranscriptUpdate?.(transcriptPayload);

        if (transcriptPayload.displayText.trim() && transcriptPayload.displayText !== prevPartialText) {
          prevPartialText = transcriptPayload.displayText;
          resetTextIdleTimer();
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
    textOffset = lastKnownDisplayText.length;
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
    textOffset = 0;
    lastKnownDisplayText = '';
    prevPartialText = '';
    lastTranscriptSeq = 0;
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
