import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';
import type { AgentStreamChunk, LlmDoneData } from '../../types';
import { setupEventSubscription } from '../PiMonoStreamAdapter';

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
};

describe('PiMonoStreamAdapter', () => {
  it('llm:done usage 会携带当前模型上下文窗口', () => {
    const chunks: AgentStreamChunk[] = [];
    const unsubscribe = setupEventSubscription(
      makeSession([
        {
          type: 'message_start',
          message: { role: 'assistant' }
        },
        {
          type: 'message_end',
          message: {
            role: 'assistant',
            id: 'msg-1',
            usage: {
              input: 120,
              output: 30,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 150
            }
          }
        }
      ]),
      {
        onChunk: (chunk) => chunks.push(chunk),
        onTextDelta: vi.fn(),
        toolCalls: [],
        contextWindow: 8192
      },
      log
    );

    unsubscribe();

    const done = chunks.find((chunk) => chunk.type === 'llm:done');
    const doneData = done?.data as LlmDoneData | undefined;
    expect(doneData?.usage).toMatchObject({
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      contextWindow: 8192
    });
  });
});

function makeSession(events: unknown[]): AgentSession {
  return {
    subscribe(listener: (event: unknown) => void): () => void {
      events.forEach(listener);
      return vi.fn();
    }
  } as unknown as AgentSession;
}
