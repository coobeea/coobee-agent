/**
 * Worker Hook — Worker 子进程注册
 *
 * READY 阶段：扫描内置 Worker 目录自动发现并注册所有 Worker，
 *            异步启动 autoStart 的 Worker（不阻塞主进程）。
 *
 * 扩展方式：在 resources/workers 下新建目录，放入 worker.json + server.py，
 *          无需改动任何 TypeScript 代码。
 */

import { log } from '@main/common/logger';
import { eventBus } from '@main/common/eventbus';
import { WorkerManager } from '@main/common/worker';
import type { WorkerStatusEvent } from '@main/common/worker/types';
import { LifecyclePhase, type LifecycleContext, type LifecycleHook } from '@main/common/types';

let bridgedManager: WorkerManager | null = null;
let cleanupWorkerEventBridge: (() => void) | null = null;

function ensureWorkerEventBridge(manager: WorkerManager): void {
  if (bridgedManager === manager) return;

  cleanupWorkerEventBridge?.();

  const forwardStatus = (event: WorkerStatusEvent): void => {
    eventBus.emit('worker:status', event);
  };

  manager.on('worker:status', forwardStatus);
  bridgedManager = manager;
  cleanupWorkerEventBridge = () => {
    manager.off('worker:status', forwardStatus);
    bridgedManager = null;
    cleanupWorkerEventBridge = null;
  };
}

/**
 * READY 阶段 Hook：扫描 + 注册 + 异步启动
 */
export const ReadyWorkerRegistrationHook: LifecycleHook = {
  name: 'ready-worker-registration',
  phase: LifecyclePhase.READY,
  priority: 80, // 较低优先级，窗口和 API 先准备好
  critical: false, // 非关键，Worker 启动失败不阻断 app

  async execute(_context: LifecycleContext): Promise<void> {
    const manager = WorkerManager.getInstance();
    ensureWorkerEventBridge(manager);

    // 自动扫描内置 Worker 目录，发现并注册所有 Worker
    const count = manager.scanAndRegister();

    if (count === 0) {
      log.info('[ReadyWorkerRegistrationHook] 未发现任何 Worker');
      return;
    }

    // 启动配置文件监控（热重载）
    manager.startWatching();

    // 异步启动 autoStart 的 Worker（不 await，不阻塞）
    const configs = manager.getRegisteredWorkers();
    const autoStartWorkers = configs.filter((c) => c.autoStart && c.enable !== false);

    if (autoStartWorkers.length > 0) {
      const workerNames = autoStartWorkers.map((c) => c.name).join(', ');
      log.info(`[ReadyWorkerRegistrationHook] 后台启动 Worker: ${workerNames}`);

      for (const config of autoStartWorkers) {
        manager.start(config.name).catch((err) => {
          log.error(`[ReadyWorkerRegistrationHook] Worker "${config.name}" 后台启动失败:`, err);
        });
      }
    } else {
      log.info('[ReadyWorkerRegistrationHook] 无 autoStart Worker，等待按需启动');
    }
  }
};
