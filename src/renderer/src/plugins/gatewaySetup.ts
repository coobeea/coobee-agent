/**
 * Gateway 初始化插件
 *
 * 创建全局 GatewayClient 单例，等待后端就绪后再建立连接。
 * 并自动启动全局流式消息监听。
 *
 * 使用方式：
 *   import { gateway } from '@/plugins/gatewaySetup'
 *   const result = await gateway.request('worker.list')
 */

import type { App } from 'vue';
import configManager from '@/config';
import eventBus from '@/eventbus';
import { EventTypes } from '@shared/ipc/events';
import { GatewayClient } from '@/services/GatewayClient';
import { useChatStore } from '@/stores/chat';
import type { StreamMessage } from '@shared/stream-protocol';

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

/**
 * 启动全局流式消息监听
 */
function setupGlobalStreamListener(): void {
  gateway.on('stream:message', (payload: unknown) => {
    const event = payload as { message?: StreamMessage };
    const msg = event.message;

    if (!msg) {
      console.warn('[gatewaySetup] Invalid stream:message event, missing message field');
      return;
    }

    // 自动存入 chatStore
    const chatStore = useChatStore();
    chatStore.handleStreamMessage(msg);
  });

  console.log('[gatewaySetup] Global stream listener initialized');
}

export default {
  install(_app: App): void {
    if (isInitialized) {
      console.warn('[gatewaySetup] Already initialized');
      return;
    }

    isInitialized = true;
    connectWhenReady();
    setupGlobalStreamListener();
    console.log('[gatewaySetup] Gateway and stream listener setup complete');
  }
};
