import { createLogger } from '@main/common/logger';
import { ThreadExecutor } from '../ThreadExecutor';
import { ThreadStore } from './ThreadStore';
import type { ThreadIndexEntry } from './types';

const log = createLogger('thread-waker');

const RECOVERY_MESSAGE =
  `[System] The application was restarted while a task was in progress. ` +
  `The previous execution state has been preserved. ` +
  `Please describe what you'd like to do next, or ask me to continue the previous task.`;

function needsStartupRecovery(thread: ThreadIndexEntry): boolean {
  return thread.status === 'active' && thread.runStatus === 'running';
}

/**
 * 系统启动时扫描未完成的 Thread 并提交恢复消息。
 *
 * 恢复通过 ThreadExecutor 走正常执行通道；runStatus 由执行器负责同步。
 */
export async function recoverPendingThreads(): Promise<void> {
  try {
    const threadStore = await ThreadStore.getInstance();
    const allThreads = await threadStore.listAsync();
    const pendingThreads = allThreads.filter(needsStartupRecovery);

    if (pendingThreads.length === 0) {
      log.info('[ThreadWaker] No pending threads to recover on startup');
      return;
    }

    log.info(`[ThreadWaker] Found ${pendingThreads.length} pending thread(s) to recover`);

    for (const thread of pendingThreads) {
      await submitRecoveryMessage(thread.id);
    }
  } catch (error) {
    log.error('[ThreadWaker] Startup recovery scan failed:', error);
  }
}

async function submitRecoveryMessage(threadId: string): Promise<void> {
  try {
    log.info(`[ThreadWaker] Resuming thread ${threadId}`);

    const result = await ThreadExecutor.submit(threadId, RECOVERY_MESSAGE);

    if (result.status === 'busy') {
      log.warn(`[ThreadWaker] Thread ${threadId} is busy, skipping recovery`);
      return;
    }

    log.info(`[ThreadWaker] Thread ${threadId} resumed successfully`);
  } catch (error) {
    log.error(`[ThreadWaker] Failed to submit resume message for ${threadId}:`, error);
  }
}
