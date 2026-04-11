/**
 * Gateway 初始化插件
 *
 * 创建全局 GatewayClient 单例，等待后端就绪后再建立连接。
 *
 * 使用方式：
 *   import { gateway } from '@/plugins/gatewaySetup'
 *   const result = await gateway.request('worker.list')
 *   gateway.on('stream:message', (payload) => { ... })
 */

import type { App } from 'vue';
import configManager from '@/config';
import eventBus from '@/eventbus';
import { EventTypes } from '@shared/ipc/events';
import { GatewayClient } from '@/services/GatewayClient';

// ==================== 全局单例 ====================

export const gateway = new GatewayClient(configManager.getGatewayWsUrl());

// ==================== Vue Plugin ====================

const READY_TIMEOUT_MS = 5000;
let isInitialized = false;

async function connectWhenReady(): Promise<void> {
  // 监听 backend:ready 事件
  let settled = false;
  const settle = (): void => {
    if (settled) return;
    settled = true;
    console.log('[gatewaySetup] Backend ready, connecting to Gateway WebSocket...');
    gateway.connect();
  };

  eventBus.once(EventTypes.BACKEND_READY, settle);

  // 超时兜底（确保即使没有收到事件也能连接）
  setTimeout(() => {
    if (!settled) {
      console.warn('[gatewaySetup] Backend ready timeout, connecting anyway');
      settle();
    }
  }, READY_TIMEOUT_MS);
}

export default {
  install(_app: App): void {
    if (isInitialized) {
      console.warn('[gatewaySetup] Already initialized');
      return;
    }

    isInitialized = true;
    connectWhenReady();
    console.log('[gatewaySetup] Waiting for backend ready before connecting');
  }
};
