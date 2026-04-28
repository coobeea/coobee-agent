/**
 * EventBus 模块统一导出
 *
 * 前端 EventBus - 基于 mitt 实现
 * 统一管理前端事件分发，支持来自主进程的 IPC 事件和前端内部事件
 */

import mitt, { type Emitter } from 'mitt';
import type { FrontendEventPayloads, FrontendEventType, FrontendGenericEventHandler } from '@shared/events/frontend';

class FrontendEventBus {
  private emitter: Emitter<Record<FrontendEventType, unknown>>;

  constructor() {
    this.emitter = mitt();
  }

  /**
   * 订阅事件
   * @param eventType 事件类型
   * @param callback 回调函数
   */
  on<T extends FrontendEventType>(eventType: T, callback: (data: FrontendEventPayloads[T]) => void): void {
    this.emitter.on(eventType, callback as FrontendGenericEventHandler);
  }

  /**
   * 分发事件
   * @param eventType 事件类型
   * @param data 事件数据
   */
  emit<T extends FrontendEventType>(eventType: T, data: FrontendEventPayloads[T]): void {
    this.emitter.emit(eventType, data);
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  private onceMap = new WeakMap<Function, FrontendGenericEventHandler>();

  /**
   * 单次订阅（触发一次后自动取消）
   * @param eventType 事件类型
   * @param callback 回调函数
   */
  once<T extends FrontendEventType>(eventType: T, callback: (data: FrontendEventPayloads[T]) => void): void {
    const wrappedCallback = (data: FrontendEventPayloads[T]): void => {
      this.off(eventType, wrappedCallback);
      this.onceMap.delete(callback);
      callback(data);
    };
    this.onceMap.set(callback, wrappedCallback as FrontendGenericEventHandler);
    this.on(eventType, wrappedCallback);
  }

  /**
   * 取消订阅
   * @param eventType 事件类型
   * @param callback 回调函数
   */
  off<T extends FrontendEventType>(eventType: T, callback: (data: FrontendEventPayloads[T]) => void): void {
    // 检查是否是被 once 包裹的回调
    const wrappedCallback = this.onceMap.get(callback);
    if (wrappedCallback) {
      this.emitter.off(eventType, wrappedCallback);
      this.onceMap.delete(callback);
    } else {
      this.emitter.off(eventType, callback as FrontendGenericEventHandler);
    }
  }

  /**
   * 清除所有事件监听
   */
  clear(): void {
    this.emitter.all.clear();
  }

  /**
   * 获取所有已注册的事件类型
   */
  getRegisteredEvents(): FrontendEventType[] {
    return Array.from(this.emitter.all.keys()) as FrontendEventType[];
  }
}

// 创建单例
export const eventBus = new FrontendEventBus();

// 默认导出
export default eventBus;

// 同时导出 useEventBus
export { useEventBus } from '@/composables/useEventBus';
