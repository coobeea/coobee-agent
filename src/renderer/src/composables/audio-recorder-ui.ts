import type { AsrStatusPayload } from '@/composables/useAudioRecorder';

export type LiveCaptionTone = 'active' | 'processing' | 'recognized';

export const LIVE_CAPTION_TAIL_CHARS = 36;
export const SPEECH_VOLUME_THRESHOLD = 2;
export const ASR_SPEECH_END_BUSY_MS = 2500;
export const ASR_RECOGNIZING_BUSY_MS = 6000;

export interface AsrCaptionSnapshot {
  tone: LiveCaptionTone;
  text: string;
  busyDurationMs?: number;
  speechActivity?: boolean;
  clearBusy?: boolean;
}

export function getTextTail(text: string, maxChars = LIVE_CAPTION_TAIL_CHARS): string {
  const chars = Array.from(text.trim());
  if (chars.length <= maxChars) return chars.join('');
  return `...${chars.slice(-maxChars).join('')}`;
}

export function formatBufferedDuration(ms?: number): string {
  if (!ms || ms < 1000) return '';
  return `${(ms / 1000).toFixed(1)}s`;
}

export function smoothVoiceLevel(current: number, volume: number): number {
  const nextLevel = Math.min(1, volume / 100);
  return Math.max(nextLevel, current * 0.72);
}

export function mapAsrStatusToCaption(payload: AsrStatusPayload): AsrCaptionSnapshot {
  switch (payload.status) {
    case 'speech_start':
      return {
        tone: 'active',
        text: '听到声音，正在接收',
        speechActivity: true,
        clearBusy: true
      };
    case 'speech_active': {
      const duration = formatBufferedDuration(payload.bufferedMs);
      return {
        tone: 'active',
        text: duration ? `正在接收语音 ${duration}` : '正在接收语音',
        speechActivity: true,
        clearBusy: true
      };
    }
    case 'speech_end':
      return {
        tone: 'processing',
        text: '正在整理这句话',
        busyDurationMs: ASR_SPEECH_END_BUSY_MS
      };
    case 'recognizing': {
      const duration = formatBufferedDuration(payload.bufferedMs);
      return {
        tone: 'processing',
        text: duration ? `正在识别 ${duration} 语音` : '正在识别语音',
        busyDurationMs: ASR_RECOGNIZING_BUSY_MS
      };
    }
    case 'recognized':
      return {
        tone: 'recognized',
        text: payload.textTail ? `识别到：${getTextTail(payload.textTail)}` : '识别完成',
        clearBusy: true
      };
    default:
      return {
        tone: 'processing',
        text: '正在处理语音'
      };
  }
}
