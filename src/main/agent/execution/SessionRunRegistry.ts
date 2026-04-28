import { createLogger } from '@main/common/logger';
import type { ThreadRunStatus } from '../threads/types';

const log = createLogger('ai');

interface ActiveSessionInfo {
  startedAt: number;
  controller: AbortController;
  lastRunStatus?: ThreadRunStatus;
}

/**
 * 运行中 Session 注册表。
 *
 * 负责同一 session 的 busy 锁、AbortController 和 Thread runStatus 同步。
 * AgentExecutor 只做流程编排，不直接维护这些状态细节。
 */
export class SessionRunRegistry {
  private activeSessions = new Map<string, ActiveSessionInfo>();

  start(sessionId: string): { status: 'accepted'; signal: AbortSignal } | { status: 'busy' } {
    if (this.activeSessions.has(sessionId)) {
      log.warn(`[SessionRunRegistry] Session busy: ${sessionId}`);
      return { status: 'busy' };
    }

    const controller = new AbortController();
    this.activeSessions.set(sessionId, {
      startedAt: Date.now(),
      controller
    });

    return { status: 'accepted', signal: controller.signal };
  }

  finish(sessionId: string): void {
    this.activeSessions.delete(sessionId);
  }

  getSignal(sessionId: string): AbortSignal | undefined {
    return this.activeSessions.get(sessionId)?.controller.signal;
  }

  getStatus(sessionId: string): { busy: boolean; startedAt?: number } {
    const info = this.activeSessions.get(sessionId);
    return info ? { busy: true, startedAt: info.startedAt } : { busy: false };
  }

  getActiveSessions(): Array<{ sessionId: string; startedAt: number }> {
    return Array.from(this.activeSessions.entries()).map(([sessionId, info]) => ({
      sessionId,
      startedAt: info.startedAt
    }));
  }

  abort(sessionId: string): boolean {
    const info = this.activeSessions.get(sessionId);
    if (!info) {
      log.warn(`[SessionRunRegistry] Cannot abort session: ${sessionId} (not found or not running)`);
      return false;
    }

    log.info(`[SessionRunRegistry] Aborting session: ${sessionId}`);
    info.controller.abort();
    return true;
  }

  updateRunStatus(sessionId: string, runStatus: ThreadRunStatus): void {
    if (sessionId.includes(':')) return;

    const info = this.activeSessions.get(sessionId);
    if (info?.lastRunStatus === runStatus) {
      return;
    }
    if (info) {
      info.lastRunStatus = runStatus;
    }

    import('../threads/ThreadStore')
      .then(({ ThreadStore }) => ThreadStore.getInstance())
      .then((store) => store.update(sessionId, { runStatus }))
      .catch(() => {});
  }
}

export const sessionRunRegistry = new SessionRunRegistry();
