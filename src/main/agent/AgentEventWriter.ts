/**
 * @deprecated P1 重构后，事件持久化和前端推送统一走：
 * Runtime/Extension -> EventBus -> StreamConsumers(EventWriter/HistoryWriter)。
 *
 * 本文件仅保留为 Extension API 的兼容适配层：
 * - 不再直接写 `events.jsonl`
 * - 不再直接持有 StreamEmitter
 * - 只把 StreamChunk 包装成 StreamEvent 后投递到 EventBus
 */

import { eventBus } from '@main/common/eventbus';
import { createLogger } from '@main/common/logger';
import type { StreamChunk, StreamChunkType } from './runtime/types';
import { StreamEventType, type StreamEvent, type StreamMessage, type StreamSource } from './streaming/types';

const log = createLogger('event-writer');

/** 会话级 writer 注册表：仅为旧 API 兼容保留 */
const sessionWriters = new Map<string, AgentEventWriter>();
const sessionSequences = new Map<string, number>();

const LIFECYCLE_EVENT_MAP: Partial<Record<StreamChunkType, StreamEventType>> = {
  'run:start': StreamEventType.START,
  'run:done': StreamEventType.END,
  'run:error': StreamEventType.ERROR
};

export class AgentEventWriter {
  private sessionId: string | null = null;

  constructor(_workspace: string | undefined) {
    // workspace 参数为旧版直写 events.jsonl 保留；当前实现不再直接使用。
  }

  /** 彻底清理当前实例（供异常销毁时备用） */
  destroy(sessionId: string): void {
    this.unregister(sessionId);
  }

  /** 注册到会话注册表 */
  register(sessionId: string): void {
    this.sessionId = sessionId;
    sessionWriters.set(sessionId, this);
  }

  /** @deprecated EventBus 已是统一出口，保留 no-op 以兼容旧调用方 */
  setEmitter(_emitter: unknown): void {
    // no-op
  }

  /** 从注册表中移除 */
  unregister(sessionId: string): void {
    if (sessionWriters.get(sessionId) === this) {
      sessionWriters.delete(sessionId);
    }
    sessionSequences.delete(sessionId);
    this.sessionId = null;
  }

  /**
   * 分发事件到 EventBus。
   *
   * @returns 分配的 sequence 编号；未注册 session 时返回 0。
   */
  dispatch(chunk: StreamChunk): number {
    if (!this.sessionId) {
      log.debug('[AgentEventWriter] dispatch ignored: no registered session');
      return 0;
    }
    return AgentEventWriter.dispatchToEventBus(this.sessionId, chunk);
  }

  /** 事件文件路径：旧版 API 兼容，当前不再直接管理文件 */
  get filePath(): string | null {
    return null;
  }

  /**
   * 通过 sessionId 分发事件。
   *
   * Extension 调用此方法后，事件进入统一 EventBus 链路，由 StreamConsumers
   * 负责写盘和前端推送。子会话事件会额外转发到主 thread。
   */
  static dispatchForSession(sessionId: string, chunk: StreamChunk): void {
    AgentEventWriter.dispatchToEventBus(sessionId, chunk);

    if (sessionId.includes(':')) {
      const mainThreadId = sessionId.split(':')[0];
      const modifiedChunk: StreamChunk = {
        ...chunk,
        data: {
          ...(chunk.data ?? {}),
          subSessionId: sessionId
        }
      };
      AgentEventWriter.dispatchToEventBus(mainThreadId, modifiedChunk);
      log.debug(`[AgentEventWriter] Forwarded event from ${sessionId} to ${mainThreadId}`);
    }
  }

  /** 获取指定会话的 writer（调试用） */
  static getWriter(sessionId: string): AgentEventWriter | undefined {
    return sessionWriters.get(sessionId);
  }

  private static dispatchToEventBus(sessionId: string, chunk: StreamChunk): number {
    const sequence = nextSequence(sessionId);
    const message = buildMessage(sessionId, sequence, chunk);

    const event: StreamEvent = {
      type: StreamEventType.MESSAGE,
      sessionId,
      message,
      timestamp: Date.now()
    };
    eventBus.emit(StreamEventType.MESSAGE, event);

    const lifecycleType = LIFECYCLE_EVENT_MAP[chunk.type];
    if (lifecycleType) {
      eventBus.emit(lifecycleType, {
        type: lifecycleType,
        sessionId,
        source: message.source,
        ...(chunk.type === 'run:error' ? { error: chunk.content } : {}),
        timestamp: Date.now()
      } satisfies StreamEvent);
    }

    return sequence;
  }
}

function nextSequence(sessionId: string): number {
  const next = (sessionSequences.get(sessionId) ?? 0) + 1;
  sessionSequences.set(sessionId, next);
  return next;
}

function buildMessage(sessionId: string, sequence: number, chunk: StreamChunk): StreamMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    sessionId,
    sequence,
    type: chunk.type,
    content: chunk.content,
    data: chunk.data as Record<string, unknown> | undefined,
    timestamp: Date.now(),
    source: getSource(chunk)
  };
}

function getSource(chunk: StreamChunk): StreamSource {
  const data = chunk.data as Record<string, unknown> | undefined;
  return {
    type: 'agent',
    id: typeof data?.agentId === 'string' ? data.agentId : 'extension',
    name: typeof data?.agentName === 'string' ? data.agentName : 'Extension'
  };
}
