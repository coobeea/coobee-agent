import type { StreamMessage } from '../stream-protocol';
import { AgentEventTypes } from './agent';
import type { AgentMessage } from './agent';
import { ThreadEventTypes } from './thread';
import type { ThreadMessageEventPayload } from './thread';
import { WorkerEventTypes } from './worker';
import type { WorkerErrorEventPayload, WorkerProgressEventPayload, WorkerStatusEventPayload } from './worker';

/**
 * Gateway 推送到前端的事件类型。
 */
export const GatewayEventTypes = {
  /** Agent 流式消息 */
  STREAM_MESSAGE: 'stream:message',
  /** Thread 元信息变更 */
  THREAD_MESSAGE: ThreadEventTypes.MESSAGE,
  /** Agent 主动发送给前端的 UI 消息 */
  AGENT_MESSAGE: AgentEventTypes.MESSAGE,
  /** Worker 状态变更 */
  WORKER_STATUS: WorkerEventTypes.STATUS,
  /** Worker 进度事件 */
  WORKER_PROGRESS: WorkerEventTypes.PROGRESS,
  /** Worker 错误事件 */
  WORKER_ERROR: WorkerEventTypes.ERROR
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
  [GatewayEventTypes.AGENT_MESSAGE]: AgentMessage;
  [GatewayEventTypes.WORKER_STATUS]: WorkerStatusEventPayload;
  [GatewayEventTypes.WORKER_PROGRESS]: WorkerProgressEventPayload;
  [GatewayEventTypes.WORKER_ERROR]: WorkerErrorEventPayload;
}
