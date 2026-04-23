import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '@main/common/eventbus';
import { EventWriter } from '../consumers/EventWriter';
import { HistoryWriter } from '../consumers/HistoryWriter';
import { StreamEventType, type StreamEvent } from '../types';

vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }),
  log: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

describe('stream consumer writers', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-consumer-writers-'));
    eventBus.removeAllListeners(StreamEventType.MESSAGE);
  });

  afterEach(() => {
    eventBus.removeAllListeners(StreamEventType.MESSAGE);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('EventWriter 异步写入 events.jsonl 并在 clearSession 时 flush', async () => {
    const writer = new EventWriter(tmpDir);
    writer.start();

    eventBus.emit(StreamEventType.MESSAGE, makeEvent('thread-1', 'text:delta', 'hello'));
    eventBus.emit(StreamEventType.MESSAGE, makeEvent('thread-1', 'run:done', ''));

    await writer.clearSession('thread-1');
    await writer.stop();

    const eventsFile = path.join(tmpDir, 'thread-1', 'events.jsonl');
    const lines = fs.readFileSync(eventsFile, 'utf-8').trim().split('\n');
    expect(lines.map((line) => JSON.parse(line).type)).toEqual(['text:delta', 'run:done']);
    expect(lines.map((line) => JSON.parse(line).seq)).toEqual([1, 2]);
  });

  it('HistoryWriter 异步聚合 assistant turn 和 user message', async () => {
    const writer = new HistoryWriter(tmpDir);
    writer.start();

    writer.writeUserMessage('thread-1', 'hi');
    eventBus.emit(StreamEventType.MESSAGE, makeEvent('thread-1', 'turn:start', ''));
    eventBus.emit(StreamEventType.MESSAGE, makeEvent('thread-1', 'text:delta', 'hello'));
    eventBus.emit(StreamEventType.MESSAGE, makeEvent('thread-1', 'turn:done', ''));

    await writer.clearSession('thread-1');
    await writer.stop();

    const historyFile = path.join(tmpDir, 'thread-1', 'history.jsonl');
    const lines = fs
      .readFileSync(historyFile, 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ role: 'user', content: 'hi' });
    expect(lines[1]).toMatchObject({ role: 'assistant', content: 'hello' });
  });
});

function makeEvent(sessionId: string, type: string, content: string): StreamEvent {
  return {
    type: StreamEventType.MESSAGE,
    sessionId,
    message: {
      id: `${type}-${Date.now()}`,
      sessionId,
      sequence: 1,
      type,
      content,
      timestamp: Date.now(),
      source: { type: 'agent', id: 'agent-1', name: 'Agent' }
    },
    timestamp: Date.now()
  };
}
