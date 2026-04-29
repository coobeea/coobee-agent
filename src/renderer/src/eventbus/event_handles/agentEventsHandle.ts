/**
 * Gateway Agent Message 事件处理器。
 *
 * Gateway 只负责把 agent:message 桥接到前端 EventBus；
 * 这里负责根据 action 调用具体 UI 能力。
 */
import { AgentEventTypes, BuiltinAgentMessageActions } from '@shared/events/agent';
import type { AgentMessage, AgentMessageLevel } from '@shared/events/agent';
import { useMessageStore } from '@/components/Message/store';
import eventBus from '@/eventbus';
import { useOpenFiles } from '@/composables/useOpenFiles';

function getString(data: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = data?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function getLevel(data: Record<string, unknown> | undefined): AgentMessageLevel {
  const level = getString(data, 'level');
  if (level === 'success' || level === 'warning' || level === 'error') {
    return level;
  }
  return 'info';
}

function notify(text: string, level: AgentMessageLevel): void {
  const messageStore = useMessageStore();

  switch (level) {
    case 'success':
      messageStore.success(text);
      return;
    case 'warning':
      messageStore.warning(text);
      return;
    case 'error':
      messageStore.error(text);
      return;
    case 'info':
    default:
      messageStore.info(text);
  }
}

function handleAgentMessage(message: AgentMessage): void {
  const { openFile, openUrl } = useOpenFiles();
  const payload = message.payload;

  switch (message.action) {
    case BuiltinAgentMessageActions.NOTIFY: {
      if (!payload.text) {
        console.warn('[AgentEvents] Invalid notify message, missing payload.text', message);
        return;
      }
      notify(payload.text, getLevel(payload.data));
      return;
    }

    case BuiltinAgentMessageActions.OPEN_PREVIEW: {
      const url = getString(payload.data, 'url');
      if (!url) {
        console.warn('[AgentEvents] Invalid open-preview message, missing payload.data.url', message);
        return;
      }
      openUrl(url, payload.text);
      return;
    }

    case BuiltinAgentMessageActions.OPEN_FILE: {
      const path = getString(payload.data, 'path');
      if (!path) {
        console.warn('[AgentEvents] Invalid open-file message, missing payload.data.path', message);
        return;
      }
      openFile(path);
      return;
    }

    default:
      console.warn(`[AgentEvents] Unsupported agent action: ${message.action}`, message);
  }
}

export function setup(): void {
  eventBus.on(AgentEventTypes.MESSAGE, handleAgentMessage);

  console.log('[AgentEvents] Agent Message 事件处理器已注册');
}
