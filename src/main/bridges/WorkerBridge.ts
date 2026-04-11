/**
 * Worker 事件桥接
 *
 * 监听 EventBus 的 worker:* 事件，转发到 WebSocket 客户端
 *
 * 事件映射：
 *   EventBus worker:status   → Gateway event 'worker:status'
 *   EventBus worker:progress → Gateway event 'worker:progress'
 *   EventBus worker:error    → Gateway event 'worker:error'
 */

import { eventBus } from '@main/common/eventbus';
import { log } from '@main/common/logger';
import type { EventBridgeInit } from '@main/common/gateway';

export const initWorkerBridge: EventBridgeInit = (gateway) => {
  const handleWorkerStatus = (data: { workerId: string; status: string }): void => {
    gateway.broadcastEvent('worker:status', data);
  };

  const handleWorkerProgress = (data: { workerId: string; progress: number }): void => {
    gateway.broadcastEvent('worker:progress', data);
  };

  const handleWorkerError = (data: { workerId: string; error: string }): void => {
    gateway.broadcastEvent('worker:error', data);
  };

  // 注册 EventBus 监听器
  eventBus.on('worker:status', handleWorkerStatus);
  eventBus.on('worker:progress', handleWorkerProgress);
  eventBus.on('worker:error', handleWorkerError);

  log.info('[WorkerBridge] Worker 事件桥接初始化完成');

  // 返回清理函数
  return () => {
    eventBus.off('worker:status', handleWorkerStatus);
    eventBus.off('worker:progress', handleWorkerProgress);
    eventBus.off('worker:error', handleWorkerError);
    log.info('[WorkerBridge] Worker 事件桥接已清理');
  };
};
