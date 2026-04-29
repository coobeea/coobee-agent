import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openFile: vi.fn(),
  openUrl: vi.fn(),
  messageInfo: vi.fn(),
  messageSuccess: vi.fn(),
  messageWarning: vi.fn(),
  messageError: vi.fn()
}));

vi.mock('@/composables/useOpenFiles', () => ({
  useOpenFiles: () => ({
    openFile: mocks.openFile,
    openUrl: mocks.openUrl
  })
}));

vi.mock('@/components/Message/store', () => ({
  useMessageStore: () => ({
    info: mocks.messageInfo,
    success: mocks.messageSuccess,
    warning: mocks.messageWarning,
    error: mocks.messageError
  })
}));

import { AgentEventTypes, BuiltinAgentMessageActions } from '@shared/events/agent';
import type { AgentMessage, AgentMessagePayload } from '@shared/events/agent';
import eventBus from '@/eventbus';
import { setup } from '../agentEventsHandle';

function createMessage(action: string, payload: AgentMessagePayload): AgentMessage {
  return {
    type: AgentEventTypes.MESSAGE,
    action,
    payload,
    meta: {},
    timestamp: 1
  };
}

describe('agentEventsHandle', () => {
  beforeEach(() => {
    eventBus.clear();
    vi.clearAllMocks();
    setup();
  });

  it('should show notify toast', () => {
    eventBus.emit(
      AgentEventTypes.MESSAGE,
      createMessage(BuiltinAgentMessageActions.NOTIFY, { text: 'Done', data: { level: 'success' } })
    );

    expect(mocks.messageSuccess).toHaveBeenCalledWith('Done');
    expect(mocks.messageInfo).not.toHaveBeenCalled();
  });

  it('should open URL preview', () => {
    eventBus.emit(
      AgentEventTypes.MESSAGE,
      createMessage(BuiltinAgentMessageActions.OPEN_PREVIEW, {
        text: 'Preview',
        data: { url: 'http://localhost:3000' }
      })
    );

    expect(mocks.openUrl).toHaveBeenCalledWith('http://localhost:3000', 'Preview');
  });

  it('should open file', () => {
    eventBus.emit(
      AgentEventTypes.MESSAGE,
      createMessage(BuiltinAgentMessageActions.OPEN_FILE, {
        text: 'View file',
        data: { path: '/tmp/result.md' }
      })
    );

    expect(mocks.openFile).toHaveBeenCalledWith('/tmp/result.md');
  });
});
