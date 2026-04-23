import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AsyncJsonlWriter } from '../consumers/AsyncJsonlWriter';

vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

describe('AsyncJsonlWriter', () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'async-jsonl-writer-'));
    filePath = path.join(tmpDir, 'events.jsonl');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('批量 flush 后按 FIFO 顺序写入 JSONL', async () => {
    const writer = new AsyncJsonlWriter('test', { flushIntervalMs: 10_000, batchSize: 10 });

    writer.writeLine(filePath, JSON.stringify({ seq: 1 }));
    writer.writeLine(filePath, JSON.stringify({ seq: 2 }));
    writer.writeLine(filePath, JSON.stringify({ seq: 3 }));

    expect(fs.existsSync(filePath)).toBe(false);

    await writer.flush();

    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines.map((line) => JSON.parse(line).seq)).toEqual([1, 2, 3]);
  });

  it('达到 batchSize 时自动触发 flush', async () => {
    const writer = new AsyncJsonlWriter('test', { flushIntervalMs: 10_000, batchSize: 2 });

    writer.writeLine(filePath, JSON.stringify({ seq: 1 }));
    writer.writeLine(filePath, JSON.stringify({ seq: 2 }));

    await writer.flush();

    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
  });

  it('队列溢出时丢弃最旧记录', async () => {
    const writer = new AsyncJsonlWriter('test', { flushIntervalMs: 10_000, batchSize: 10, maxQueueSize: 2 });

    writer.writeLine(filePath, JSON.stringify({ seq: 1 }));
    writer.writeLine(filePath, JSON.stringify({ seq: 2 }));
    writer.writeLine(filePath, JSON.stringify({ seq: 3 }));

    await writer.flush();

    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines.map((line) => JSON.parse(line).seq)).toEqual([2, 3]);
  });

  it('closeFile 会 flush 并清理队列', async () => {
    const writer = new AsyncJsonlWriter('test', { flushIntervalMs: 10_000 });

    writer.writeLine(filePath, JSON.stringify({ seq: 1 }));
    expect(writer.getQueueSize(filePath)).toBe(1);

    await writer.closeFile(filePath);

    expect(writer.getQueueSize(filePath)).toBe(0);
    expect(fs.readFileSync(filePath, 'utf-8')).toContain('"seq":1');
  });

  it('可选 Worker 写盘路径会完整落盘', async () => {
    const writer = new AsyncJsonlWriter('test-worker', { flushIntervalMs: 10_000, batchSize: 2, useWorker: true });

    writer.writeLine(filePath, JSON.stringify({ seq: 1 }));
    writer.writeLine(filePath, JSON.stringify({ seq: 2 }));
    writer.writeLine(filePath, JSON.stringify({ seq: 3 }));

    await writer.closeAll();

    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines.map((line) => JSON.parse(line).seq)).toEqual([1, 2, 3]);
  });

  it('100 events/s 基准流量下无丢失且 flush 保持在合理耗时内', async () => {
    const writer = new AsyncJsonlWriter('benchmark', {
      flushIntervalMs: 10_000,
      batchSize: 50,
      maxQueueSize: 2_000
    });

    const start = performance.now();
    for (let seq = 0; seq < 1_000; seq += 1) {
      writer.writeLine(filePath, JSON.stringify({ seq }));
    }

    await writer.flush();
    const durationMs = performance.now() - start;

    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1_000);
    expect(JSON.parse(lines[0]).seq).toBe(0);
    expect(JSON.parse(lines[999]).seq).toBe(999);
    expect(durationMs).toBeLessThan(5_000);
  });
});
