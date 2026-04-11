/**
 * Gateway 初始化插件
 *
 * 创建全局 GatewayClient 单例，等待后端就绪后再建立连接。
 *
 * 使用方式：
 *   import { gateway } from '@/plugins/gatewaySetup'
 *   const result = await gateway.request('worker.list')
 *   gateway.on('stream.message', (payload) => { ... })
 */

import type { App } from 'vue';
// import configManager from '@/config';
// import eventBus from '@/eventbus';
// import { EventTypes } from '@shared/ipc/events';
// import { GatewayClient } from '@/services/GatewayClient';
// import { initThreadWs } from '@/composables/useThreadWs';
// import { initAgentEvents } from '@/composables/useAgentEvents';

// ==================== 全局单例 ====================

// export const gateway = new GatewayClient(configManager.getGatewayWsUrl());
export const gateway = null as any; // 临时占位

// ==================== Vue Plugin ====================

// const READY_TIMEOUT_MS = 5000;
let isInitialized = false;

// async function connectWhenReady(): Promise<void> {
//   // 监听 backend:ready 事件
//   let settled = false;
//   const settle = (): void => {
//     if (settled) return;
//     settled = true;
//     gateway.connect();
//   };

//   eventBus.once(EventTypes.BACKEND_READY, settle);

//   // 超时兜底
//   setTimeout(() => {
//     if (!settled) {
//       console.warn('[gatewaySetup] Backend ready timeout, connecting anyway');
//       settle();
//     }
//   }, READY_TIMEOUT_MS);
// }

export default {
  install(_app: App): void {
    if (isInitialized) {
      console.warn('[gatewaySetup] Already initialized');
      return;
    }

    isInitialized = true;
    // initThreadWs();
    // initAgentEvents();
    // connectWhenReady();
    console.log('[gatewaySetup] Plugin installed (业务逻辑暂时禁用)');
  }
};
