import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '@main/common/eventbus';
import { EventWriter } from '../consumers/EventWriter';
import { HistoryWriter } from '../consumers/HistoryWriter';
import { StreamEventType, type StreamEvent } from '../types';

const layoutState = vi.hoisted(() => ({
  tmpDir: ''
}));

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

vi.mock('@main/agent/context/AgentRuntimeLayout', () => ({
  resolveThreadRuntimeLayoutSync: vi.fn((sessionId: string) => ({
    sessionDir: `${layoutState.tmpDir}/${sessionId}`
  }))
}));

describe('stream consumer writers', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-consumer-writers-'));
    layoutState.tmpDir = tmpDir;
    eventBus.removeAllListeners(StreamEventType.MESSAGE);
  });

  afterEach(() => {
    eventBus.removeAllListeners(StreamEventType.MESSAGE);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('EventWriter 异步写入 events.jsonl 并在 clearSession 时 flush', async () => {
    const writer = new EventWriter();
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

  it('HistoryWriter 按 run 写入一条 assistant v2 和 user message', async () => {
    const writer = new HistoryWriter();
    writer.start();

    writer.writeUserMessage('thread-1', 'hi');
    eventBus.emit(StreamEventType.MESSAGE, makeEvent('thread-1', 'run:start', ''));
    eventBus.emit(StreamEventType.MESSAGE, makeEvent('thread-1', 'turn:start', '', { turnIndex: 1 }));
    eventBus.emit(StreamEventType.MESSAGE, makeEvent('thread-1', 'text:delta', 'hello'));
    eventBus.emit(
      StreamEventType.MESSAGE,
      makeEvent('thread-1', 'llm:done', '', {
        usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5, contextWindow: 128000 }
      })
    );
    eventBus.emit(StreamEventType.MESSAGE, makeEvent('thread-1', 'turn:done', '', { turnIndex: 1 }));
    eventBus.emit(StreamEventType.MESSAGE, makeEvent('thread-1', 'run:done', ''));

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
    expect(lines[1]).toMatchObject({
      version: 2,
      role: 'assistant',
      status: 'done',
      content: 'hello',
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5, contextWindow: 128000 }
    });
    expect(lines[1].turns).toHaveLength(1);
    expect(lines[1].turns[0]).toMatchObject({
      index: 1,
      status: 'done',
      content: 'hello',
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5, contextWindow: 128000 }
    });
  });

  it('HistoryWriter 多 turn 聚合为一条 assistant v2 并累加 usage 和工具调用', async () => {
    const writer = new HistoryWriter();
    writer.start();

    eventBus.emit(StreamEventType.MESSAGE, makeEvent('thread-1', 'run:start', ''));
    eventBus.emit(StreamEventType.MESSAGE, makeEvent('thread-1', 'turn:start', '', { turnIndex: 1 }));
    eventBus.emit(StreamEventType.MESSAGE, makeEvent('thread-1', 'reasoning:delta', 'think'));
    eventBus.emit(
      StreamEventType.MESSAGE,
      makeEvent('thread-1', 'tool:start', '', {
        toolName: 'search',
        callId: 'call-1'
      })
    );
    eventBus.emit(
      StreamEventType.MESSAGE,
      makeEvent('thread-1', 'tool:pending', '', {
        toolName: 'search',
        callId: 'call-1',
        arguments: { q: 'hello' }
      })
    );
    eventBus.emit(
      StreamEventType.MESSAGE,
      makeEvent('thread-1', 'tool:done', 'result', {
        callId: 'call-1',
        output: 'result'
      })
    );
    eventBus.emit(
      StreamEventType.MESSAGE,
      makeEvent('thread-1', 'llm:done', '', {
        usage: { inputTokens: 10, outputTokens: 1, totalTokens: 11 }
      })
    );
    eventBus.emit(StreamEventType.MESSAGE, makeEvent('thread-1', 'turn:done', '', { turnIndex: 1 }));
    eventBus.emit(StreamEventType.MESSAGE, makeEvent('thread-1', 'turn:start', '', { turnIndex: 2 }));
    eventBus.emit(StreamEventType.MESSAGE, makeEvent('thread-1', 'text:delta', 'final'));
    eventBus.emit(
      StreamEventType.MESSAGE,
      makeEvent('thread-1', 'llm:done', '', {
        usage: { inputTokens: 20, outputTokens: 3, totalTokens: 23 }
      })
    );
    eventBus.emit(StreamEventType.MESSAGE, makeEvent('thread-1', 'turn:done', '', { turnIndex: 2 }));
    eventBus.emit(StreamEventType.MESSAGE, makeEvent('thread-1', 'run:done', ''));

    await writer.flush();
    await writer.stop();

    const historyFile = path.join(tmpDir, 'thread-1', 'history.jsonl');
    const lines = fs
      .readFileSync(historyFile, 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      version: 2,
      role: 'assistant',
      content: 'final',
      usage: { inputTokens: 30, outputTokens: 4, totalTokens: 34 }
    });
    expect(lines[0].turns).toHaveLength(2);
    expect(lines[0]).not.toHaveProperty('reasoning');
    expect(lines[0].turns[0]).toMatchObject({
      index: 1,
      reasoning: 'think'
    });
    expect(lines[0].turns[0].toolCalls).toEqual([
      expect.objectContaining({
        name: 'search',
        callId: 'call-1',
        arguments: { q: 'hello' },
        result: 'result',
        status: 'done'
      })
    ]);
    expect(lines[0].turns[1]).toMatchObject({
      index: 2,
      content: 'final',
      usage: { inputTokens: 20, outputTokens: 3, totalTokens: 23 }
    });
  });

  it('HistoryWriter 在 run:error 和 stop 时收口未完成 run', async () => {
    const errorWriter = new HistoryWriter();
    errorWriter.start();

    eventBus.emit(StreamEventType.MESSAGE, makeEvent('thread-error', 'run:start', ''));
    eventBus.emit(StreamEventType.MESSAGE, makeEvent('thread-error', 'turn:start', '', { turnIndex: 1 }));
    eventBus.emit(StreamEventType.MESSAGE, makeEvent('thread-error', 'text:delta', 'partial'));
    eventBus.emit(StreamEventType.MESSAGE, makeEvent('thread-error', 'run:error', 'boom'));

    await errorWriter.flush();
    await errorWriter.stop();

    const errorLine = JSON.parse(fs.readFileSync(path.join(tmpDir, 'thread-error', 'history.jsonl'), 'utf-8').trim());
    expect(errorLine).toMatchObject({
      version: 2,
      status: 'error',
      content: 'partial',
      error: 'boom'
    });
    expect(errorLine.turns[0]).toMatchObject({ status: 'error', content: 'partial' });

    const interruptedWriter = new HistoryWriter();
    interruptedWriter.start();

    eventBus.emit(StreamEventType.MESSAGE, makeEvent('thread-interrupted', 'run:start', ''));
    eventBus.emit(StreamEventType.MESSAGE, makeEvent('thread-interrupted', 'turn:start', '', { turnIndex: 1 }));
    eventBus.emit(StreamEventType.MESSAGE, makeEvent('thread-interrupted', 'text:delta', 'draft'));

    await interruptedWriter.stop();

    const interruptedLine = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'thread-interrupted', 'history.jsonl'), 'utf-8').trim()
    );
    expect(interruptedLine).toMatchObject({
      version: 2,
      status: 'interrupted',
      content: 'draft'
    });
    expect(interruptedLine.turns[0]).toMatchObject({ status: 'interrupted', content: 'draft' });
  });
});

function makeEvent(sessionId: string, type: string, content: string, data?: Record<string, unknown>): StreamEvent {
  return {
    type: StreamEventType.MESSAGE,
    sessionId,
    message: {
      id: `${type}-${Date.now()}`,
      sessionId,
      sequence: 1,
      type,
      content,
      data,
      timestamp: Date.now(),
      source: { type: 'agent', id: 'agent-1', name: 'Agent' }
    },
    timestamp: Date.now()
  };
}
