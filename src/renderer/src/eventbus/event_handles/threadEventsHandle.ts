/**
 * Gateway Thread 事件处理器。
 */
import { ThreadEventTypes, type ThreadMessageEventPayload } from '@shared/events/thread';
import eventBus from '@/eventbus';
import { useThreadsStore } from '@/stores/threads';

function handleThreadMessage(payload: ThreadMessageEventPayload): void {
  const threadsStore = useThreadsStore();
  threadsStore.applyThreadMessage(payload);
}

export function setup(): void {
  eventBus.on(ThreadEventTypes.MESSAGE, handleThreadMessage);

  console.log('[ThreadEvents] Thread 事件处理器已注册');
}
