import { describe, expect, it } from 'vitest';
import type { ProviderConfig } from '@main/agent/provider/types';
import { AgentRuntimeBuilder } from '../AgentRuntimeBuilder';

const providerConfig: ProviderConfig = {
  id: 'ollama',
  name: 'Ollama',
  api: 'openai-compatible',
  baseUrl: 'http://127.0.0.1:11434/v1',
  apiKey: 'test-key',
  enabled: true,
  models: [
    {
      id: 'gemma4:e4b',
      name: 'Gemma 4 E4B',
      reasoning: false,
      contextWindow: 8192,
      maxOutputTokens: 4096,
      maxThinkingTokens: 1024,
      functionCalling: true
    }
  ]
};

describe('AgentRuntimeBuilder', () => {
  it('从 Provider 模型配置注入模型元数据', async () => {
    const runtime = await new AgentRuntimeBuilder()
      .type('pi-mono')
      .fromProviderConfig(providerConfig, 'gemma4:e4b')
      .build();

    expect(runtime.options.provider).toBe('ollama');
    expect(runtime.options.model).toBe('gemma4:e4b');
    expect(runtime.options.baseURL).toBe('http://127.0.0.1:11434/v1');
    expect(runtime.options.modelMeta).toMatchObject({
      reasoning: false,
      contextWindow: 8192,
      maxOutputTokens: 4096,
      maxThinkingTokens: 1024,
      functionCalling: true
    });
  });

  it('显式传入的 modelMeta 优先于 Provider 默认值', async () => {
    const runtime = await new AgentRuntimeBuilder()
      .type('pi-mono')
      .fromProviderConfig(providerConfig, 'gemma4:e4b')
      .modelMeta({
        reasoning: true,
        contextWindow: 32768,
        maxOutputTokens: 2048
      })
      .build();

    expect(runtime.options.modelMeta).toMatchObject({
      reasoning: true,
      contextWindow: 32768,
      maxOutputTokens: 2048,
      maxThinkingTokens: 1024,
      functionCalling: true
    });
  });
});
