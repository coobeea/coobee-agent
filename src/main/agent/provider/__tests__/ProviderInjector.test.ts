import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderInjector } from '../ProviderInjector';

const mocks = vi.hoisted(() => ({
  getDefaultModel: vi.fn(() => 'ollama/gemma4:e4b'),
  resolveModel: vi.fn((modelSpec: string) => ({
    provider: {
      id: 'ollama',
      name: 'Ollama',
      baseUrl: 'http://localhost:11434/v1',
      api: 'openai-compatible',
      enabled: true
    },
    model: {
      id: modelSpec.split('/')[1] ?? modelSpec,
      name: modelSpec
    },
    fullSpec: modelSpec
  })),
  getProvider: vi.fn(() => ({
    id: 'ollama',
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    api: 'openai-compatible',
    enabled: true,
    apiKey: 'test-key',
    models: [{ id: 'gemma4:e4b', name: 'Gemma 4' }]
  })),
  resolveApiKey: vi.fn(() => 'test-key')
}));

vi.mock('@main/config', () => ({
  Models: {
    getDefaultModel: mocks.getDefaultModel,
    resolveModel: mocks.resolveModel
  },
  Providers: {
    getProvider: mocks.getProvider
  }
}));

vi.mock('../ApiKeyResolver', () => ({
  resolveApiKey: mocks.resolveApiKey
}));

function createBuilder(): {
  fromProviderConfig: (config: unknown, modelId?: string) => unknown;
  model: (model: string) => unknown;
  apiType: (apiType: unknown) => unknown;
  thinkingLevel: (level: unknown) => unknown;
} {
  return {
    fromProviderConfig: vi.fn((_config: unknown, _modelId?: string) => undefined),
    model: vi.fn((_model: string) => undefined),
    apiType: vi.fn((_apiType: unknown) => undefined),
    thinkingLevel: vi.fn((_level: unknown) => undefined)
  };
}

describe('ProviderInjector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('旧版模型组覆盖不会阻断默认模型注入', () => {
    const builder = createBuilder();

    new ProviderInjector().apply(builder, '@group:default');

    expect(mocks.getDefaultModel).toHaveBeenCalled();
    expect(mocks.resolveModel).toHaveBeenCalledWith('ollama/gemma4:e4b');
    expect(builder.fromProviderConfig).toHaveBeenCalled();
    expect(builder.model).not.toHaveBeenCalled();
  });
});
