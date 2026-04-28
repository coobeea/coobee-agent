import type { GatewayEventPayloads } from './gateway';
import type { EventPayloads as IpcEventPayloads } from './ipc';

/**
 * Renderer EventBus 可消费的所有前后端事件。
 *
 * IPC 和 Gateway 都先进入前端 EventBus，再由具体 handler 消费。
 */
export type FrontendEventPayloads = IpcEventPayloads & GatewayEventPayloads;

export type FrontendEventType = Extract<keyof FrontendEventPayloads, string>;

export type FrontendEventHandler<T extends FrontendEventType> = (payload: FrontendEventPayloads[T]) => void;

export type FrontendGenericEventHandler = (payload: unknown) => void;
