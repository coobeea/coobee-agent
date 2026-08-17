import type { EventType } from './EventType';
import { Meta } from './Meta';

/** 写入 Redis Stream / SSE / events.jsonl 的标准事件信封。 */
export class Envelope {
  ts: string;
  type: EventType;
  content: string;
  data: Record<string, unknown>;
  meta: Meta;
  /** Redis Stream 消息 ID；仅 events.jsonl 落盘时写入。 */
  eventId?: string;

  constructor(init: {
    ts: string;
    type: EventType;
    content: string;
    data?: Record<string, unknown>;
    meta: Meta;
    eventId?: string;
  }) {
    this.ts = init.ts;
    this.type = init.type;
    this.content = init.content;
    this.data = init.data ?? {};
    this.meta = init.meta;
    this.eventId = init.eventId;
  }

  static create(
    ts: string,
    type: EventType,
    content: string,
    data: Record<string, unknown> | undefined,
    meta: Meta
  ): Envelope {
    meta.validate();
    return new Envelope({ ts, type, content, data: data ?? {}, meta });
  }

  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = {
      ts: this.ts,
      type: this.type,
      content: this.content,
      data: this.data,
      meta: this.meta.toJSON()
    };
    if (this.eventId) {
      out.event_id = this.eventId;
    }
    return out;
  }
}
