/**
 * Stream 事件桥接
 *
 * 监听 EventBus 的 stream:* 事件，转发到 WebSocket 客户端
 *
 * 事件映射：
 *   EventBus stream:message → Gateway event 'stream:message'
 *   EventBus stream:start   → Gateway event 'stream:start'
 *   EventBus stream:end     → Gateway event 'stream:end'
 *   EventBus stream:error   → Gateway event 'stream:error'
 */

import { eventBus } from '@main/common/eventbus';
import { log } from '@main/common/logger';
import type { EventBridgeInit } from '@main/common/gateway';

export const initStreamBridge: EventBridgeInit = (gateway) => {
  const handleStreamMessage = (data: { sessionId: string; message: string }): void => {
    gateway.broadcastEvent('stream:message', data);
  };

  const handleStreamStart = (data: { sessionId: string }): void => {
    gateway.broadcastEvent('stream:start', data);
  };

  const handleStreamEnd = (data: { sessionId: string }): void => {
    gateway.broadcastEvent('stream:end', data);
  };

  const handleStreamError = (data: { sessionId: string; error: string }): void => {
    gateway.broadcastEvent('stream:error', data);
  };

  // 注册 EventBus 监听器
  eventBus.on('stream:message', handleStreamMessage);
  eventBus.on('stream:start', handleStreamStart);
  eventBus.on('stream:end', handleStreamEnd);
  eventBus.on('stream:error', handleStreamError);

  log.info('[StreamBridge] Stream 事件桥接初始化完成');

  // 返回清理函数
  return () => {
    eventBus.off('stream:message', handleStreamMessage);
    eventBus.off('stream:start', handleStreamStart);
    eventBus.off('stream:end', handleStreamEnd);
    eventBus.off('stream:error', handleStreamError);
    log.info('[StreamBridge] Stream 事件桥接已清理');
  };
};
