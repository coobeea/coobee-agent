import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openFile: vi.fn(),
  openUrl: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  toastError: vi.fn()
}));

vi.mock('@/composables/useOpenFiles', () => ({
  useOpenFiles: () => ({
    openFile: mocks.openFile,
    openUrl: mocks.openUrl
  })
}));

vi.mock('vue-sonner', () => ({
  toast: {
    info: mocks.toastInfo,
    success: mocks.toastSuccess,
    warning: mocks.toastWarning,
    error: mocks.toastError
  }
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

    expect(mocks.toastSuccess).toHaveBeenCalledWith('Done');
    expect(mocks.toastInfo).not.toHaveBeenCalled();
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
