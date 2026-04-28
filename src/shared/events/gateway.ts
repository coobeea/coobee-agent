import type { StreamMessage } from '../stream-protocol';
import { ThreadEventTypes } from './thread';
import type { ThreadMessageEventPayload } from './thread';

/**
 * Gateway 推送到前端的事件类型。
 */
export const GatewayEventTypes = {
  /** Agent 流式消息 */
  STREAM_MESSAGE: 'stream:message',
  /** Thread 元信息变更 */
  THREAD_MESSAGE: ThreadEventTypes.MESSAGE
} as const;

export type GatewayEventType = (typeof GatewayEventTypes)[keyof typeof GatewayEventTypes];

/**
 * stream:message 的 Gateway payload。
 *
 * 这是后端 StreamEmitter 写入 EventBus 后，经 Gateway 原样转发给前端的数据。
 */
export interface StreamMessageEventPayload {
  type: typeof GatewayEventTypes.STREAM_MESSAGE;
  sessionId: string;
  message: StreamMessage;
  timestamp: number;
}

/**
 * Gateway 事件 Payload 类型映射。
 */
export interface GatewayEventPayloads {
  [GatewayEventTypes.STREAM_MESSAGE]: StreamMessageEventPayload;
  [GatewayEventTypes.THREAD_MESSAGE]: ThreadMessageEventPayload;
}
