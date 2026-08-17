import type { Envelope } from './spec/Envelope';

/** 处理一条已发布的标准事件。 */
export type EventConsumer = (envelope: Envelope) => void | Promise<void>;

/**
 * 进程内标准事件总线契约。
 */
export interface EventBus {
  registerConsumer(topic: string, fn: EventConsumer): void;
  registerQueuedConsumer(topic: string, fn: EventConsumer, queueSize?: number): void;
  registerAsyncConsumer(topic: string, fn: EventConsumer, transactional?: boolean): void;

  dispatch(topic: string, envelope: Envelope): Promise<void>;
  dispatchRunEvent(envelope: Envelope): Promise<void>;

  waitAsyncConsumers(): Promise<void>;
  closeConsumers(): Promise<void>;
}
