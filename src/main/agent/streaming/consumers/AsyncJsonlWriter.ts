/**
 * AsyncJsonlWriter
 *
 * Lightweight batched JSONL writer used by stream consumers. It keeps the
 * EventBus listener path cheap and flushes file writes asynchronously.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { createLogger } from '@main/common/logger';

const log = createLogger('async-jsonl-writer');

export interface AsyncJsonlWriterOptions {
  flushIntervalMs?: number;
  batchSize?: number;
  maxQueueSize?: number;
  failureThreshold?: number;
  syncMode?: boolean;
  useWorker?: boolean;
}

interface FileQueueState {
  queue: string[];
  timer?: NodeJS.Timeout;
  flushing?: Promise<void>;
  failureCount: number;
  syncMode: boolean;
  droppedCount: number;
}

const DEFAULT_OPTIONS: Required<AsyncJsonlWriterOptions> = {
  flushIntervalMs: 100,
  batchSize: 20,
  maxQueueSize: 1000,
  failureThreshold: 3,
  syncMode: process.env.COOBEE_AGENT_SYNC_STREAM_WRITES === '1' || process.env.SYNC_MODE === '1',
  useWorker: process.env.COOBEE_AGENT_STREAM_WRITE_WORKER === '1'
};

interface WorkerPending {
  resolve: () => void;
  reject: (err: Error) => void;
}

interface WorkerResultMessage {
  id: number;
  ok: boolean;
  error?: string;
}

const JSONL_WRITE_WORKER_SCRIPT = `
const { parentPort } = require('node:worker_threads');
const fs = require('node:fs/promises');
const path = require('node:path');

parentPort.on('message', async (message) => {
  if (!message || message.type !== 'append') return;

  try {
    await fs.mkdir(path.dirname(message.filePath), { recursive: true });
    await fs.appendFile(message.filePath, message.payload, 'utf-8');
    parentPort.postMessage({ id: message.id, ok: true });
  } catch (error) {
    parentPort.postMessage({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
`;

class JsonlWriteWorkerBridge {
  private worker?: Worker;
  private nextId = 1;
  private readonly pending = new Map<number, WorkerPending>();

  constructor(private readonly name: string) {}

  append(filePath: string, payload: string): Promise<void> {
    const worker = this.ensureWorker();
    const id = this.nextId;
    this.nextId += 1;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        worker.postMessage({ type: 'append', id, filePath, payload });
      } catch (err) {
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async destroy(): Promise<void> {
    const worker = this.worker;
    this.worker = undefined;
    this.failPending(new Error(`[${this.name}] JSONL write worker closed`));

    if (worker) {
      await worker.terminate();
    }
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    const worker = new Worker(JSONL_WRITE_WORKER_SCRIPT, { eval: true });
    worker.on('message', (message: WorkerResultMessage) => this.handleMessage(message));
    worker.on('error', (err) => this.handleWorkerError(err));
    worker.on('exit', (code) => {
      this.worker = undefined;
      if (code !== 0) {
        this.failPending(new Error(`[${this.name}] JSONL write worker exited with code ${code}`));
      }
    });

    this.worker = worker;
    return worker;
  }

  private handleMessage(message: WorkerResultMessage): void {
    const pending = this.pending.get(message.id);
    if (!pending) return;

    this.pending.delete(message.id);
    if (message.ok) {
      pending.resolve();
      return;
    }

    pending.reject(new Error(message.error ?? `[${this.name}] JSONL write worker append failed`));
  }

  private handleWorkerError(err: Error): void {
    this.worker = undefined;
    this.failPending(err);
  }

  private failPending(err: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(err);
    }
    this.pending.clear();
  }
}

export class AsyncJsonlWriter {
  private readonly options: Required<AsyncJsonlWriterOptions>;
  private readonly queues = new Map<string, FileQueueState>();
  private workerBridge?: JsonlWriteWorkerBridge;

  constructor(
    private readonly name: string,
    options: AsyncJsonlWriterOptions = {}
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  writeLine(filePath: string, line: string): void {
    const state = this.getState(filePath);

    if (state.syncMode) {
      this.appendSync(filePath, line + '\n');
      return;
    }

    if (state.queue.length >= this.options.maxQueueSize) {
      state.queue.shift();
      state.droppedCount += 1;
      log.warn(`[${this.name}] Queue overflow for ${filePath}; dropped oldest line (${state.droppedCount} total)`);
    }

    state.queue.push(line);

    if (state.queue.length >= this.options.batchSize) {
      void this.flush(filePath);
    } else {
      this.scheduleFlush(filePath, state);
    }
  }

  async flush(filePath?: string): Promise<void> {
    if (filePath) {
      const state = this.queues.get(filePath);
      if (!state) return;
      await this.flushFile(filePath, state);
      return;
    }

    await Promise.all([...this.queues.entries()].map(([target, state]) => this.flushFile(target, state)));
  }

  async closeFile(filePath: string): Promise<void> {
    await this.flush(filePath);
    const state = this.queues.get(filePath);
    if (state?.timer) {
      clearTimeout(state.timer);
    }
    this.queues.delete(filePath);
  }

  async closeAll(): Promise<void> {
    await this.flush();
    for (const state of this.queues.values()) {
      if (state.timer) clearTimeout(state.timer);
    }
    this.queues.clear();
    await this.workerBridge?.destroy();
    this.workerBridge = undefined;
  }

  getQueueSize(filePath?: string): number {
    if (filePath) return this.queues.get(filePath)?.queue.length ?? 0;
    return [...this.queues.values()].reduce((sum, state) => sum + state.queue.length, 0);
  }

  private getState(filePath: string): FileQueueState {
    let state = this.queues.get(filePath);
    if (!state) {
      state = {
        queue: [],
        failureCount: 0,
        syncMode: this.options.syncMode,
        droppedCount: 0
      };
      this.queues.set(filePath, state);
    }
    return state;
  }

  private scheduleFlush(filePath: string, state: FileQueueState): void {
    if (state.timer) return;
    state.timer = setTimeout(() => {
      state.timer = undefined;
      void this.flush(filePath);
    }, this.options.flushIntervalMs);
  }

  private async flushFile(filePath: string, state: FileQueueState): Promise<void> {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = undefined;
    }

    if (state.flushing) {
      await state.flushing;
      if (state.queue.length > 0) {
        await this.flushFile(filePath, state);
      }
      return;
    }

    state.flushing = this.flushFileInternal(filePath, state).finally(() => {
      state.flushing = undefined;
    });
    await state.flushing;
  }

  private async flushFileInternal(filePath: string, state: FileQueueState): Promise<void> {
    if (state.syncMode) {
      this.flushSync(filePath, state);
      return;
    }

    while (state.queue.length > 0 && !state.syncMode) {
      const batch = state.queue.splice(0, Math.max(this.options.batchSize, state.queue.length));
      const payload = batch.map((line) => line + '\n').join('');

      try {
        await this.appendAsync(filePath, payload);
        state.failureCount = 0;
      } catch (err) {
        state.queue.unshift(...batch);
        state.failureCount += 1;
        log.warn(`[${this.name}] Async flush failed for ${filePath}:`, err);

        if (state.failureCount >= this.options.failureThreshold) {
          state.syncMode = true;
          log.warn(`[${this.name}] Falling back to sync mode for ${filePath}`);
          this.flushSync(filePath, state);
          return;
        }

        this.scheduleFlush(filePath, state);
        return;
      }
    }
  }

  private flushSync(filePath: string, state: FileQueueState): void {
    while (state.queue.length > 0) {
      const batch = state.queue.splice(0, state.queue.length);
      try {
        this.appendSync(filePath, batch.map((line) => line + '\n').join(''));
        state.failureCount = 0;
      } catch (err) {
        state.queue.unshift(...batch);
        state.failureCount += 1;
        log.warn(`[${this.name}] Sync flush failed for ${filePath}:`, err);
        return;
      }
    }
  }

  private appendSync(filePath: string, payload: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, payload, 'utf-8');
  }

  private async appendAsync(filePath: string, payload: string): Promise<void> {
    if (this.options.useWorker) {
      try {
        this.workerBridge ??= new JsonlWriteWorkerBridge(this.name);
        await this.workerBridge.append(filePath, payload);
        return;
      } catch (err) {
        log.warn(`[${this.name}] Worker append failed for ${filePath}; falling back to async append:`, err);
      }
    }

    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.appendFile(filePath, payload, 'utf-8');
  }
}
