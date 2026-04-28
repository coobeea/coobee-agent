/**
 * Gateway Stream 事件处理器。
 *
 * Gateway 只负责把后端事件桥接到前端 EventBus；
 * 这里负责消费 stream 事件并同步到 chatStore。
 */
import { GatewayEventTypes, type GatewayEventPayloads } from '@shared/events/gateway';
import eventBus from '@/eventbus';
import { useChatStore } from '@/stores/chat';

function handleStreamMessage(payload: GatewayEventPayloads['stream:message']): void {
  const msg = payload.message;

  if (!msg) {
    console.warn('[StreamEvents] Invalid stream:message event, missing message field');
    return;
  }

  const chatStore = useChatStore();
  chatStore.handleStreamMessage(msg);
}

export function setup(): void {
  eventBus.on(GatewayEventTypes.STREAM_MESSAGE, handleStreamMessage);

  console.log('[StreamEvents] Stream 事件处理器已注册');
}
