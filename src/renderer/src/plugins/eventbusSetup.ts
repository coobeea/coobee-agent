/**
 * 事件处理器统一注册
 */

import { setup as setupTabEvents } from '../eventbus/event_handles/tabEventsHandle';
import { setup as setupWindowEvents } from '../eventbus/event_handles/windowEventsHandle';
import { setup as setupAppEvents } from '../eventbus/event_handles/appEventsHandle';
import { setup as setupStreamEvents } from '../eventbus/event_handles/streamEventsHandle';
import { setup as setupThreadEvents } from '../eventbus/event_handles/threadEventsHandle';
import { useLogStore } from '@/stores/log';

/**
 * 设置所有事件处理器
 */
export function setupEventHandlers(): void {
  setupTabEvents();
  setupWindowEvents();
  setupAppEvents();
  setupStreamEvents();
  setupThreadEvents();

  const logStore = useLogStore();
  logStore.info('system', '所有事件处理器已注册');
}

export default {
  install: (): void => {
    setupEventHandlers();
  }
};
