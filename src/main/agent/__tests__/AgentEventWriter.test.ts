import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StreamEvent } from '../streaming/types';

const { mockEventBus } = vi.hoisted(() => ({
  mockEventBus: {
    emit: vi.fn()
  }
}));

vi.mock('@main/common/eventbus', () => ({
  eventBus: mockEventBus
}));

vi.mock('@main/common/logger', () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { log, createLogger: vi.fn(() => log) };
});

import { AgentEventWriter } from '../AgentEventWriter';
import { StreamEventType } from '../streaming/types';

describe('AgentEventWriter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('作为兼容适配层将 StreamChunk 转发到 EventBus', () => {
    AgentEventWriter.dispatchForSession('thread-1', {
      type: 'text:delta',
      content: 'hello',
      data: { delta: 'hello' }
    });

    expect(mockEventBus.emit).toHaveBeenCalledTimes(1);
    const [eventType, event] = mockEventBus.emit.mock.calls[0] as [string, StreamEvent];
    expect(eventType).toBe(StreamEventType.MESSAGE);
    expect(event.sessionId).toBe('thread-1');
    expect(event.message?.type).toBe('text:delta');
    expect(event.message?.content).toBe('hello');
  });

  it('子会话事件会额外转发到主 thread，并标记 subSessionId', () => {
    AgentEventWriter.dispatchForSession('thread-1:delegate:agent-a', {
      type: 'tool:pending',
      content: 'approval needed'
    });

    expect(mockEventBus.emit).toHaveBeenCalledTimes(2);
    const forwarded = mockEventBus.emit.mock.calls[1][1] as StreamEvent;
    expect(forwarded.sessionId).toBe('thread-1');
    expect(forwarded.message?.data?.subSessionId).toBe('thread-1:delegate:agent-a');
  });

  it('旧实例 API register + dispatch 仍然可用', () => {
    const writer = new AgentEventWriter('/tmp/workspace');
    writer.register('thread-2');
    const seq = writer.dispatch({ type: 'run:start', content: '' });

    expect(seq).toBe(1);
    expect(mockEventBus.emit).toHaveBeenCalledWith(
      StreamEventType.START,
      expect.objectContaining({ sessionId: 'thread-2' })
    );
    writer.unregister('thread-2');
  });
});
