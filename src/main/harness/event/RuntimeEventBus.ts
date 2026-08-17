import { RunEventTopic } from '../types/Constants';
import type { Envelope } from './spec/Envelope';
import type { EventBus, EventConsumer } from './EventBus';

interface QueuedWorker {
  topic: string;
  fn: EventConsumer;
  queue: Envelope[];
  capacity: number;
  running: boolean;
  closed: boolean;
  drainPromise: Promise<void> | null;
}

/**
 * 进程内事件总线：同步链 + 有界队列异步消费者。
 */
export class RuntimeEventBus implements EventBus {
  private readonly sync = new Map<string, EventConsumer[]>();
  private readonly queued: QueuedWorker[] = [];

  registerConsumer(topic: string, fn: EventConsumer): void {
    if (!fn) return;
    const list = this.sync.get(topic) ?? [];
    list.push(fn);
    this.sync.set(topic, list);
  }

  registerQueuedConsumer(topic: string, fn: EventConsumer, queueSize = 256): void {
    if (!fn) return;
    this.queued.push({
      topic,
      fn,
      queue: [],
      capacity: Math.max(1, queueSize || 256),
      running: false,
      closed: false,
      drainPromise: null
    });
  }

  registerAsyncConsumer(topic: string, fn: EventConsumer, _transactional?: boolean): void {
    this.registerQueuedConsumer(topic, fn, 256);
  }

  async dispatch(topic: string, envelope: Envelope): Promise<void> {
    const t = topic || RunEventTopic;
    const syncFns = this.sync.get(t) ?? [];
    for (const fn of syncFns) {
      await fn(envelope);
    }
    for (const worker of this.queued) {
      if (worker.topic !== t || worker.closed) continue;
      if (worker.queue.length >= worker.capacity) {
        worker.queue.shift();
      }
      worker.queue.push(envelope);
      this.kickWorker(worker);
    }
  }

  async dispatchRunEvent(envelope: Envelope): Promise<void> {
    await this.dispatch(RunEventTopic, envelope);
  }

  async waitAsyncConsumers(): Promise<void> {
    await Promise.all(this.queued.map((w) => w.drainPromise ?? Promise.resolve()));
  }

  async closeConsumers(): Promise<void> {
    for (const worker of this.queued) {
      worker.closed = true;
    }
    await this.waitAsyncConsumers();
  }

  private kickWorker(worker: QueuedWorker): void {
    if (worker.running) return;
    worker.running = true;
    worker.drainPromise = (async () => {
      try {
        while (worker.queue.length > 0) {
          const next = worker.queue.shift()!;
          await worker.fn(next);
        }
      } finally {
        worker.running = false;
        if (worker.queue.length > 0 && !worker.closed) {
          this.kickWorker(worker);
        }
      }
    })();
  }
}
