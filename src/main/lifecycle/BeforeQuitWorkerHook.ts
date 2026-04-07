/**
 * Worker Hook — Worker 子进程关闭
 *
 * BEFORE_QUIT 阶段：停止配置文件监控并优雅关闭所有 Worker 子进程。
 */

import { log } from '@main/common/logger';
import { WorkerManager } from '@main/common/worker';
import { LifecyclePhase, type LifecycleContext, type LifecycleHook } from '@main/common/types';

/**
 * BEFORE_QUIT 阶段 Hook：优雅关闭所有 Worker
 */
export const BeforeQuitWorkerHook: LifecycleHook = {
  name: 'before-quit-worker',
  phase: LifecyclePhase.BEFORE_QUIT,
  priority: 10, // 高优先级，尽早开始停止子进程
  critical: false,

  async execute(_context: LifecycleContext): Promise<void> {
    log.info('[BeforeQuitWorkerHook] 正在关闭所有 Worker...');
    const manager = WorkerManager.getInstance();

    // 停止配置文件监控
    manager.stopWatching();

    // 停止所有 Worker
    await manager.stopAll();
    log.info('[BeforeQuitWorkerHook] 所有 Worker 已关闭');
  }
};
