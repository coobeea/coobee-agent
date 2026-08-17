import type { EventType } from './spec/EventType';
import { Envelope } from './spec/Envelope';
import { Meta } from './spec/Meta';
import type { EventBus } from './EventBus';

/** 标准事件生产侧契约。 */
export interface Emitter {
  emitEvent(type: EventType, content: string, data?: Record<string, unknown>): Promise<Envelope>;
}

/**
 * 持有 per-turn Meta，构造 Envelope 后投递 EventBus。
 */
export class StandardEmitter implements Emitter {
  constructor(
    private readonly bus: EventBus,
    private readonly meta: Meta
  ) {
    if (!bus) {
      throw new Error('event: bus is required');
    }
    if (!meta) {
      throw new Error('event: meta is required');
    }
  }

  withMeta(meta: Meta): StandardEmitter {
    return new StandardEmitter(this.bus, meta);
  }

  async emitEvent(type: EventType, content: string, data?: Record<string, unknown>): Promise<Envelope> {
    const envelope = Envelope.create(new Date().toISOString(), type, content, cloneEmitData(data), this.meta);
    // 与 abort 解耦：TAIL 事件（turn:done / run:done）仍应落盘。
    await this.bus.dispatchRunEvent(envelope);
    return envelope;
  }
}

/** 测试 / stub 用空 Emitter。 */
export class NoopEmitter implements Emitter {
  async emitEvent(type: EventType, content: string, data?: Record<string, unknown>): Promise<Envelope> {
    return new Envelope({
      ts: new Date().toISOString(),
      type,
      content,
      data: data ?? {},
      meta: Meta.create({
        runtimeId: 'noop',
        agentId: 'noop',
        sessionId: 'noop'
      })
    });
  }
}

function cloneEmitData(inData?: Record<string, unknown>): Record<string, unknown> {
  if (!inData || Object.keys(inData).length === 0) {
    return {};
  }
  return { ...inData };
}
