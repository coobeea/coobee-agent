/**
 * 事件总线 Composable
 */

import mitt, { type Emitter, type EventType } from 'mitt';
import { onUnmounted } from 'vue';

type Events = Record<EventType, unknown>;

const emitter: Emitter<Events> = mitt<Events>();

export function useEventBus() {
  const listeners: Array<{ event: EventType; handler: any }> = [];

  /**
   * 发送事件
   */
  function emit<T = any>(event: EventType, data?: T): void {
    emitter.emit(event, data);
  }

  /**
   * 监听事件
   */
  function on<T = any>(event: EventType, handler: (data: T) => void): void {
    emitter.on(event, handler as any);
    listeners.push({ event, handler });
  }

  /**
   * 监听一次事件
   */
  function once<T = any>(event: EventType, handler: (data: T) => void): void {
    const wrappedHandler = (data: T) => {
      handler(data);
      off(event, wrappedHandler);
    };
    on(event, wrappedHandler);
  }

  /**
   * 取消监听事件
   */
  function off(event: EventType, handler?: any): void {
    if (handler) {
      emitter.off(event, handler);
      const index = listeners.findIndex((l) => l.event === event && l.handler === handler);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    } else {
      emitter.off(event);
      listeners.forEach((l, index) => {
        if (l.event === event) {
          listeners.splice(index, 1);
        }
      });
    }
  }

  /**
   * 清除所有监听
   */
  function clear(): void {
    listeners.forEach(({ event, handler }) => {
      emitter.off(event, handler);
    });
    listeners.length = 0;
  }

  // 组件卸载时自动清理
  onUnmounted(() => {
    clear();
  });

  return {
    emit,
    on,
    once,
    off,
    clear
  };
}
