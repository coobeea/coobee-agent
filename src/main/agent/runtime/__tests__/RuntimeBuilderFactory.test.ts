import { describe, expect, it, vi } from 'vitest';

import { RuntimeBuilderFactory } from '../RuntimeBuilderFactory';
import { OpenAIBuilder } from '../openai/OpenAIBuilder';
import { PiMonoBuilder } from '../pimono/PiMonoBuilder';

vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

describe('RuntimeBuilderFactory', () => {
  it('默认应创建 PiMono builder，并将 thread 语义映射为 file session', () => {
    const providerInjector = {
      applyProviderConfig: vi.fn(),
      applyThinkingLevel: vi.fn()
    };
    const factory = new RuntimeBuilderFactory(providerInjector);

    const builder = factory.create({
      persistence: 'thread',
      sessionId: 'thread-1',
      agentId: 'agent-1',
      name: 'agent-1',
      instructions: 'You are a test agent',
      modelOverride: 'provider/model'
    });
    const internal = builder as unknown as {
      _sessionMode?: string;
      _sessionId?: string;
      _agentId?: string;
      _name?: string;
      _instructions?: string;
    };

    expect(builder).toBeInstanceOf(PiMonoBuilder);
    expect(internal._sessionMode).toBe('file');
    expect(internal._sessionId).toBe('thread-1');
    expect(internal._agentId).toBe('agent-1');
    expect(internal._name).toBe('agent-1');
    expect(internal._instructions).toBe('You are a test agent');
    expect(providerInjector.applyProviderConfig).toHaveBeenNthCalledWith(1, builder);
    expect(providerInjector.applyThinkingLevel).toHaveBeenCalledWith(builder);
    expect(providerInjector.applyProviderConfig).toHaveBeenNthCalledWith(2, builder, {
      modelOverride: 'provider/model',
      sessionId: 'thread-1',
      agentId: 'agent-1'
    });
  });

  it('指定 openai runtime 时应返回 OpenAI builder', () => {
    const providerInjector = {
      applyProviderConfig: vi.fn(),
      applyThinkingLevel: vi.fn()
    };
    const factory = new RuntimeBuilderFactory(providerInjector);

    const builder = factory.create({
      runtime: 'openai',
      persistence: 'thread',
      sessionId: 'thread-1',
      agentId: 'agent-1',
      name: 'agent-1'
    });
    const internal = builder as unknown as {
      _sessionId?: string;
      _agentId?: string;
    };

    expect(builder).toBeInstanceOf(OpenAIBuilder);
    expect(internal._sessionId).toBe('thread-1');
    expect(internal._agentId).toBe('agent-1');
    expect(providerInjector.applyProviderConfig).toHaveBeenCalledTimes(1);
    expect(providerInjector.applyThinkingLevel).toHaveBeenCalledWith(builder);
  });
});
