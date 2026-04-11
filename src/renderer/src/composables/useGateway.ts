/**
 * Gateway Composable
 *
 * 提供 Vue 友好的 Gateway 使用方式，自动管理生命周期。
 *
 * 特性：
 *   - 自动清理事件监听器（组件卸载时）
 *   - 响应式连接状态
 *   - 类型安全的 RPC 调用
 *
 * 使用方式：
 *   const { connectionState, on, request } = useGateway()
 *
 *   // 监听事件（组件卸载时自动清理）
 *   on('stream:message', (payload) => { ... })
 *
 *   // 发送 RPC 请求
 *   const result = await request('worker.list')
 */

import { onUnmounted } from 'vue';
import { gateway } from '@/plugins/gatewaySetup';

/**
 * Gateway Composable
 *
 * 在 Vue 组件中使用 Gateway，自动管理生命周期。
 */
export function useGateway() {
  const cleanups: (() => void)[] = [];

  /**
   * 监听事件（自动清理）
   *
   * @param event 事件名（如 'stream:message', 'worker:status'）
   * @param listener 事件处理函数
   *
   * @example
   *   on('stream:message', (payload) => {
   *     console.log('收到消息:', payload)
   *   })
   */
  function on(event: string, listener: (payload: unknown) => void): void {
    const off = gateway.on(event, listener);
    cleanups.push(off);
  }

  /**
   * 发送 RPC 请求
   *
   * @param method 方法名（如 'worker.list', 'chat.send'）
   * @param params 方法参数
   * @returns Promise<T> — 成功时返回 payload，失败时抛出错误
   *
   * @example
   *   try {
   *     const workers = await request<Worker[]>('worker.list')
   *     console.log('Worker 列表:', workers)
   *   } catch (error) {
   *     console.error('RPC 错误:', error)
   *   }
   */
  async function request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    return gateway.request<T>(method, params);
  }

  /**
   * 监听连接成功事件（含重连）
   *
   * @param handler 连接成功回调
   *
   * @example
   *   onConnect(() => {
   *     console.log('Gateway 已连接')
   *   })
   */
  function onConnect(handler: () => void): void {
    const off = gateway.onConnect(handler);
    cleanups.push(off);
  }

  // 组件卸载时自动清理所有监听器
  onUnmounted(() => {
    cleanups.forEach((fn) => fn());
    cleanups.length = 0;
  });

  return {
    /** WebSocket 连接状态（响应式） */
    connectionState: gateway.connectionState,
    /** 最后的错误信息（响应式） */
    lastError: gateway.lastError,
    /** 监听事件 */
    on,
    /** 发送 RPC 请求 */
    request,
    /** 监听连接成功 */
    onConnect
  };
}

// 导出错误类，方便组件中使用
export { GatewayRpcError } from '@/services/GatewayClient';
