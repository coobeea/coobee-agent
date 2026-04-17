/**
 * Stream WebSocket Composable
 *
 * 基于 Gateway WebSocket 的流式消息订阅管理。
 * 全局管理所有 thread 的订阅状态。
 */

import type { StreamMessage } from '@shared/stream-protocol';
import { gateway } from '@/plugins/gatewaySetup';

/** 订阅回调 */
type StreamCallback = (msg: StreamMessage) => void;

/** 全局订阅管理器 */
class StreamSubscriptionManager {
  /** sessionId -> callbacks */
  private subscriptions = new Map<string, Set<StreamCallback>>();

  /** 是否已初始化 Gateway 监听 */
  private initialized = false;

  /**
   * 初始化 Gateway 监听（全局只执行一次）
   */
  private initializeOnce(): void {
    if (this.initialized) return;

    // 监听 Gateway 的 stream:message 事件
    // payload 格式: { type: 'stream:message', sessionId: 'xxx', message: StreamMessage, timestamp: number }
    gateway.on('stream:message', (payload: unknown) => {
      const event = payload as { message?: StreamMessage; sessionId?: string };

      // 提取真正的 StreamMessage
      const msg = event.message;
      if (!msg) {
        console.warn('[useStreamWs] Invalid stream:message event, missing message field');
        return;
      }

      const callbacks = this.subscriptions.get(msg.sessionId);
      if (callbacks) {
        callbacks.forEach((cb) => cb(msg));
      }
    });

    this.initialized = true;
  }

  /**
   * 订阅 thread 的流式消息
   *
   * 注意：Gateway 会自动推送所有 stream:message 事件，
   * 此方法只是在本地注册回调，不需要调用后端订阅 RPC。
   */
  subscribe(sessionId: string, callback: StreamCallback): void {
    this.initializeOnce();

    let callbacks = this.subscriptions.get(sessionId);
    if (!callbacks) {
      callbacks = new Set();
      this.subscriptions.set(sessionId, callbacks);
    }

    callbacks.add(callback);
  }

  /**
   * 取消订阅
   */
  unsubscribe(sessionId: string, callback: StreamCallback): void {
    const callbacks = this.subscriptions.get(sessionId);
    if (!callbacks) return;

    callbacks.delete(callback);

    // 清理空的订阅集合
    if (callbacks.size === 0) {
      this.subscriptions.delete(sessionId);
    }
  }

  /**
   * 重置订阅状态
   */
  reset(): void {
    this.subscriptions.clear();
  }
}

// 全局单例
const manager = new StreamSubscriptionManager();

/**
 * 订阅 thread 的流式消息
 */
export function streamSubscribe(sessionId: string, callback: StreamCallback): void {
  manager.subscribe(sessionId, callback);
}

/**
 * 取消订阅
 */
export function streamUnsubscribe(sessionId: string, callback: StreamCallback): void {
  manager.unsubscribe(sessionId, callback);
}

/**
 * 重置所有订阅
 */
export function resetStreamSubscriptions(): void {
  manager.reset();
}
