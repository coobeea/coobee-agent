/**
 * Thread 唤醒器
 *
 * 监听 EventBus 上的 'thread:wake' 事件，从 checkpoint 恢复挂起的 Thread。
 *
 * 架构设计（职责分离）：
 *   - ThreadStore = 任务状态的真相源（runStatus）
 *   - Checkpoint = 执行快照（pendingOperation、activeAgent）
 *
 * 唤醒流程：
 *   1. 系统启动：扫描 ThreadStore 找未完成任务
 *   2. 检查 ThreadStore 确认任务状态
 *   3. 读取 Checkpoint 获取恢复细节
 *   4. 如果有 pendingOperation（审批完成后）：
 *      a. 执行被挂起的工具
 *      b. 将工具结果作为系统消息注入
 *      c. 重新启动 Agent run
 *   5. 更新 ThreadStore 状态
 *
 * 事件格式：
 *   eventBus.emit('thread:wake', {
 *     threadId: string,
 *     reason: 'tool-done' | 'restart-recovery',
 *     toolResult?: string,
 *     approvalDecision?: 'approve-once' | 'approve-always' | 'reject'
 *   })
 */

import { createLogger } from '@main/common/logger';
import { eventBus } from '@main/common/eventbus';
import { CheckpointManager } from './CheckpointManager';
import type { ThreadCheckpoint } from './types';

const log = createLogger('thread-waker');

export interface ThreadWakeEvent {
  threadId: string;
  reason: 'tool-done' | 'restart-recovery';
  toolResult?: string;
  approvalDecision?: string;
  /** 被审批的工具名称 */
  toolName?: string;
  /** 被审批的工具参数 */
  toolParams?: Record<string, unknown>;
}

export class ThreadWaker {
  private static instance: ThreadWaker | null = null;
  private listening = false;
  /** 保存 bound 函数引用，确保 removeListener 能正确移除 */
  private readonly boundHandleWake: (event: ThreadWakeEvent) => Promise<void>;

  private constructor() {
    this.boundHandleWake = this.handleWake.bind(this);
  }

  static getInstance(): ThreadWaker {
    if (!ThreadWaker.instance) {
      ThreadWaker.instance = new ThreadWaker();
    }
    return ThreadWaker.instance;
  }

  static resetInstance(): void {
    if (ThreadWaker.instance) {
      ThreadWaker.instance.stop();
    }
    ThreadWaker.instance = null;
  }

  /**
   * 开始监听唤醒事件
   */
  start(): void {
    if (this.listening) return;
    eventBus.on('thread:wake', this.boundHandleWake);
    this.listening = true;
    log.info('[ThreadWaker] Started listening for thread:wake events');
  }

  /**
   * 停止监听
   */
  stop(): void {
    if (!this.listening) return;
    eventBus.removeListener('thread:wake', this.boundHandleWake);
    this.listening = false;
    log.info('[ThreadWaker] Stopped');
  }

  private async handleWake(event: ThreadWakeEvent): Promise<void> {
    const { threadId, reason } = event;
    log.info(`[ThreadWaker] Wake event: threadId=${threadId}, reason=${reason}`);

    try {
      const { ThreadStore } = await import('./ThreadStore');
      const threadStore = await ThreadStore.getInstance();
      const threadDef = await threadStore.get(threadId);

      if (!threadDef) {
        log.warn(`[ThreadWaker] Thread ${threadId} not found in ThreadStore, skipping`);
        return;
      }

      if (threadDef.runStatus === 'idle' || threadDef.runStatus === 'completed') {
        log.info(`[ThreadWaker] Thread ${threadId} already idle/completed, skipping`);
        return;
      }

      const checkpoint = await CheckpointManager.getInstance().load(threadId);
      if (!checkpoint) {
        log.warn(`[ThreadWaker] No checkpoint found for ${threadId}, cannot recover`);
        return;
      }

      await this.resumeThread(threadId, checkpoint, event);
    } catch (error) {
      log.error(`[ThreadWaker] Failed to wake thread ${threadId}:`, error);
    }
  }

  /**
   * 恢复挂起的 Thread
   */
  private async resumeThread(threadId: string, checkpoint: ThreadCheckpoint, event: ThreadWakeEvent): Promise<void> {
    if (event.reason === 'restart-recovery') {
      await this.handleRestartRecovery(threadId, checkpoint);
    } else {
      log.info(`[ThreadWaker] Unhandled wake reason: ${event.reason}`);
    }

    const { ThreadStore } = await import('./ThreadStore');
    const threadStore = await ThreadStore.getInstance();
    await threadStore.update(threadId, { runStatus: 'running' });
  }


  /**
   * 系统重启后恢复
   *
   * 支持两种恢复模式：
   *   1. 普通 Agent Thread：通知用户中断了什么
   *   2. Discussion Thread：自动恢复讨论协调
   */
  private async handleRestartRecovery(threadId: string, checkpoint: ThreadCheckpoint): Promise<void> {
    const { ThreadStore } = await import('./ThreadStore');
    const threadStore = await ThreadStore.getInstance();
    const threadDef = await threadStore.get(threadId);

    if (!threadDef) {
      log.warn(`[ThreadWaker] Thread ${threadId} not found in ThreadStore during recovery`);
      return;
    }

    // ✅ 特殊处理：Discussion Thread 自动恢复
    if (threadDef.agentMode === 'discussion' || threadDef.agentType === 'discussion') {
      log.info(`[ThreadWaker] Recovering discussion thread: ${threadId}`);
      try {
        // const { DiscussionCoordinator } = await import('../discussion/DiscussionCoordinator');
        // await DiscussionCoordinator.resume(threadId);
        log.info(`[ThreadWaker] Discussion thread ${threadId} recovered successfully`);
      } catch (error) {
        log.error(`[ThreadWaker] Failed to recover discussion thread ${threadId}:`, error);
      }
      return;
    }

    // 普通 Agent Thread 恢复（原有逻辑）
    let message: string;

    if (threadDef.runStatus === 'running' || threadDef.runStatus === 'tool-pending') {
      message =
        `[System] The application was restarted while a task was in progress. ` +
        `The previous execution state has been preserved. ` +
        `Please describe what you'd like to do next, or ask me to continue the previous task.`;
    } else {
      log.info(`[ThreadWaker] Thread ${threadId} in status ${threadDef.runStatus}, no recovery needed`);
      return;
    }

    await this.submitResumeMessage(threadId, message);
  }

  /**
   * 向 Thread 发送恢复消息（重新启动 Agent run）
   */
  private async submitResumeMessage(threadId: string, message: string): Promise<void> {
    try {
      const { agentExecutor } = await import('../AgentExecutor');

      log.info(`[ThreadWaker] Resuming thread ${threadId} with message: ${message.slice(0, 100)}...`);

      // 使用 submit 直接提交
      const builder = agentExecutor.piMono();
      const result = agentExecutor.submit({ sessionId: threadId, message, builder });

      if (result.status === "busy") {
        log.error(`[ThreadWaker] Thread ${threadId} is busy`);
        return;
      }

      if (result.status === 'accepted') {
        log.info(`[ThreadWaker] Thread ${threadId} resumed successfully`);
      }
    } catch (error) {
      log.error(`[ThreadWaker] Failed to submit resume message for ${threadId}:`, error);
    }
  }

  /**
   * 系统启动时扫描未完成的 Thread 并恢复
   */
  async recoverOnStartup(): Promise<void> {
    try {
      const { ThreadStore } = await import('./ThreadStore');
      const threadStore = await ThreadStore.getInstance();

      const allThreads = await threadStore.list();
      const pendingThreads = allThreads.filter(
        (thread) => thread.status === 'active' && thread.runStatus !== 'idle' && thread.runStatus !== 'completed'
      );

      if (pendingThreads.length === 0) {
        log.info('[ThreadWaker] No pending threads to recover on startup');
        return;
      }

      log.info(`[ThreadWaker] Found ${pendingThreads.length} pending thread(s) to recover`);

      for (const thread of pendingThreads) {
        eventBus.emit('thread:wake', {
          threadId: thread.id,
          reason: 'restart-recovery'
        } satisfies ThreadWakeEvent);
      }
    } catch (error) {
      log.error('[ThreadWaker] Startup recovery scan failed:', error);
    }
  }
}
