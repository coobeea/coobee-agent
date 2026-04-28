import { describe, expect, it } from 'vitest';
import { SessionRunRegistry } from '../SessionRunRegistry';

describe('SessionRunRegistry', () => {
  it('同一 session 不能重复 start，finish 后可再次 start', () => {
    const registry = new SessionRunRegistry();

    const first = registry.start('session-1');
    const second = registry.start('session-1');

    expect(first.status).toBe('accepted');
    expect(second.status).toBe('busy');
    expect(registry.getStatus('session-1').busy).toBe(true);

    registry.finish('session-1');

    expect(registry.getStatus('session-1').busy).toBe(false);
    expect(registry.start('session-1').status).toBe('accepted');
  });

  it('abort 只对运行中的 session 返回 true', () => {
    const registry = new SessionRunRegistry();

    expect(registry.abort('missing')).toBe(false);

    const run = registry.start('session-2');
    expect(run.status).toBe('accepted');
    expect(registry.abort('session-2')).toBe(true);

    if (run.status === 'accepted') {
      expect(run.signal.aborted).toBe(true);
    }
  });

  it('getActiveSessions 返回所有运行中的 session', () => {
    const registry = new SessionRunRegistry();

    registry.start('session-a');
    registry.start('session-b');

    const ids = registry.getActiveSessions().map((session) => session.sessionId);
    expect(ids).toContain('session-a');
    expect(ids).toContain('session-b');
  });
});
