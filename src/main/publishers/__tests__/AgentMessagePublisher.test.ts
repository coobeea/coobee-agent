import { describe, expect, it } from 'vitest';

import publisher from '../AgentMessagePublisher';
import { AgentEventTypes } from '@shared/events/agent';

describe('AgentMessagePublisher', () => {
  it('should publish only agent:message', () => {
    expect(publisher).toEqual([AgentEventTypes.MESSAGE]);
  });
});
