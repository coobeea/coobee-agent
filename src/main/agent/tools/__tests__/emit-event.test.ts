import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@main/common/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

vi.mock('@main/common/eventbus', async () => {
  const { EventEmitter } = await import('node:events');
  return { eventBus: new EventEmitter() };
});

import { emitEventTool } from '../builtin/emit-event';
import { eventBus } from '@main/common/eventbus';
import { AgentEventTypes, BuiltinAgentMessageActions } from '@shared/events/agent';
import type { AgentMessage } from '@shared/events/agent';
import type { ToolExecutionContext } from '../types';

async function consumeGenerator(
  gen: AsyncGenerator<unknown, unknown, unknown>
): Promise<{ yields: unknown[]; result: unknown }> {
  const yields: unknown[] = [];
  let step = await gen.next();
  while (!step.done) {
    yields.push(step.value);
    step = await gen.next();
  }
  return { yields, result: step.value };
}

describe('emit_event tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should emit notify as agent:message via eventBus', async () => {
    const spy = vi.fn();
    eventBus.on(AgentEventTypes.MESSAGE, spy);

    const gen = emitEventTool.execute!(
      { event: 'notify', payload: { text: 'Task completed', data: { level: 'success' } } },
      undefined,
      { sessionId: 'sess-1', agentName: 'test-agent' } as ToolExecutionContext
    );

    const { result } = await consumeGenerator(gen);

    expect(spy).toHaveBeenCalledTimes(1);
    const emitted = spy.mock.calls[0][0] as AgentMessage;
    expect(emitted.type).toBe(AgentEventTypes.MESSAGE);
    expect(emitted.action).toBe(BuiltinAgentMessageActions.NOTIFY);
    expect(emitted.payload).toEqual({ text: 'Task completed', data: { level: 'success' } });
    expect(Object.keys(emitted.payload).sort()).toEqual(['data', 'text']);
    expect(emitted.meta).toEqual({ sessionId: 'sess-1', agentName: 'test-agent' });
    expect(typeof emitted.timestamp).toBe('number');
    expect((result as { success: boolean }).success).toBe(true);

    eventBus.off(AgentEventTypes.MESSAGE, spy);
  });

  it('should emit open-preview as agent:message', async () => {
    const spy = vi.fn();
    eventBus.on(AgentEventTypes.MESSAGE, spy);

    const gen = emitEventTool.execute!(
      { event: 'open-preview', payload: { text: 'Preview app', data: { url: 'http://localhost:3000' } } },
      undefined,
      undefined
    );
    const { result } = await consumeGenerator(gen);

    expect((result as { success: boolean }).success).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    const emitted = spy.mock.calls[0][0] as AgentMessage;
    expect(emitted.action).toBe(BuiltinAgentMessageActions.OPEN_PREVIEW);
    expect(emitted.payload).toEqual({ text: 'Preview app', data: { url: 'http://localhost:3000' } });

    eventBus.off(AgentEventTypes.MESSAGE, spy);
  });

  it('should emit open-file as agent:message', async () => {
    const spy = vi.fn();
    eventBus.on(AgentEventTypes.MESSAGE, spy);

    const gen = emitEventTool.execute!(
      { event: 'open-file', payload: { text: 'View file', data: { path: '/tmp/result.md' } } },
      undefined,
      undefined
    );
    const { result } = await consumeGenerator(gen);

    expect((result as { success: boolean }).success).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    const emitted = spy.mock.calls[0][0] as AgentMessage;
    expect(emitted.action).toBe(BuiltinAgentMessageActions.OPEN_FILE);
    expect(emitted.payload).toEqual({ text: 'View file', data: { path: '/tmp/result.md' } });

    eventBus.off(AgentEventTypes.MESSAGE, spy);
  });

  it('should reject empty event name', async () => {
    const gen = emitEventTool.execute!({ event: '' }, undefined, undefined);
    const { result } = await consumeGenerator(gen);

    expect((result as { success: boolean }).success).toBe(false);
    expect((result as { error: { code: string } }).error.code).toBe('INVALID_PARAM');
  });

  it('should reject unknown action', async () => {
    const spy = vi.fn();
    eventBus.on(AgentEventTypes.MESSAGE, spy);

    const gen = emitEventTool.execute!({ event: 'custom-action', payload: { text: 'hello' } }, undefined, undefined);
    const { result } = await consumeGenerator(gen);

    expect((result as { success: boolean }).success).toBe(false);
    expect((result as { error: { code: string } }).error.code).toBe('INVALID_PARAM');
    expect(spy).not.toHaveBeenCalled();

    eventBus.off(AgentEventTypes.MESSAGE, spy);
  });

  it('should reject notify without text', async () => {
    const gen = emitEventTool.execute!({ event: 'notify', payload: { data: { level: 'info' } } }, undefined, undefined);
    const { result } = await consumeGenerator(gen);

    expect((result as { success: boolean }).success).toBe(false);
    expect((result as { error: { code: string } }).error.code).toBe('INVALID_PARAM');
  });

  it('should reject open-preview without url', async () => {
    const gen = emitEventTool.execute!({ event: 'open-preview', payload: { text: 'Preview' } }, undefined, undefined);
    const { result } = await consumeGenerator(gen);

    expect((result as { success: boolean }).success).toBe(false);
    expect((result as { error: { code: string } }).error.code).toBe('INVALID_PARAM');
  });

  it('should reject open-file without path', async () => {
    const gen = emitEventTool.execute!({ event: 'open-file', payload: { text: 'File' } }, undefined, undefined);
    const { result } = await consumeGenerator(gen);

    expect((result as { success: boolean }).success).toBe(false);
    expect((result as { error: { code: string } }).error.code).toBe('INVALID_PARAM');
  });
});
