import { createLogger } from '@main/common/logger';
import { Models, Providers } from '@main/config';

import { resolveApiKey } from '../provider/ApiKeyResolver';
import type {
  AgentRuntimeOptions,
  RuntimeBuilderRequest,
  RuntimeKind,
  SkillDefinition,
  ThinkingLevel,
  ToolDefinition
} from './types';

const log = createLogger('agent-runtime-builder');

export type BuiltRuntimeOptions = AgentRuntimeOptions;

/**
 * 统一 runtime 参数构造请求
 *
 * 目标：替代 runtime 内部 Builder，只负责产出 RuntimeOptions。
 */
export interface AgentRuntimeBuildRequest extends RuntimeBuilderRequest {
  appendInstructions?: string[];
  skills?: SkillDefinition[];
  tools?: ToolDefinition[];
  sdkTools?: unknown[];
  sandboxContext?: import('../tools/types').ToolExecutionContext;
  signal?: AbortSignal;

  // 直接覆盖（优先级最高）
  model?: string;
  apiKey?: string;
  baseURL?: string;
  thinkingLevel?: ThinkingLevel;

  // PiMono runtime 扩展
  compaction?: PiMonoAgentRuntimeOptions['compaction'];
  retry?: PiMonoAgentRuntimeOptions['retry'];
  modelMeta?: PiMonoAgentRuntimeOptions['modelMeta'];
}

/**
 * AgentRuntimeBuilder（参数构造器）
 *
 * 只做一件事：根据上层请求 + provider 配置，产出最终 RuntimeOptions。
 */
export class AgentRuntimeBuilder {
  private request: AgentRuntimeBuildRequest;

  constructor(request: AgentRuntimeBuildRequest) {
    this.request = { ...request };
  }

  static from(request: AgentRuntimeBuildRequest): AgentRuntimeBuilder {
    return new AgentRuntimeBuilder(request);
  }

  update(patch: Partial<AgentRuntimeBuildRequest>): this {
    this.request = { ...this.request, ...patch };
    return this;
  }

  build(): BuiltRuntimeOptions {
    const runtime = this.resolveRuntimeKind(this.request.runtime);
    const providerResolved = this.resolveProviderBundle(this.request);

    const common: AgentRuntimeOptions = {
      name: this.request.name || 'agent',
      type: runtime === 'pimono' ? 'pi-mono' : 'openai',
      instructions: this.request.instructions || '',
      model: this.request.model || providerResolved.model || process.env.VITE_LLM_MODEL || 'qwen3-max',
      apiKey:
        this.request.apiKey ||
        providerResolved.apiKey ||
        process.env.OPENAI_API_KEY ||
        process.env.VITE_LLM_API_KEY ||
        'runtime-unset',
      apiType: 'openai-compatible',
      baseURL: this.request.baseURL || providerResolved.baseURL || this.defaultBaseURL(runtime)
    };

    if (this.request.appendInstructions?.length) common.appendInstructions = this.request.appendInstructions;
    if (this.request.skills?.length) common.skills = this.request.skills;
    if (this.request.tools?.length) common.tools = this.request.tools;
    if (this.request.sessionId) common.sessionId = this.request.sessionId;
    if (this.request.sessionDir) common.sessionDir = this.request.sessionDir;
    if (this.request.workspaceRoot) common.workspaceRoot = this.request.workspaceRoot;
    if (this.request.contextDir) common.contextDir = this.request.contextDir;
    if (this.request.maxTurns !== undefined) common.maxTurns = this.request.maxTurns;
    if (this.request.sandboxContext) common.sandboxContext = this.request.sandboxContext;
    if (this.request.signal) common.signal = this.request.signal;

    if (runtime === 'pimono') {
      const options: PiMonoAgentRuntimeOptions = {
        ...common,
        type: 'pi-mono'
      };

      const persistence = this.request.persistence || 'memory';
      options.sessionMode = persistence === 'thread' ? 'file' : 'memory';

      options.thinkingLevel = this.request.thinkingLevel || this.resolveDefaultThinkingLevel();
      if (this.request.compaction) options.compaction = this.request.compaction;
      if (this.request.retry) options.retry = this.request.retry;
      if (this.request.modelMeta) {
        options.modelMeta = this.request.modelMeta;
      } else if (providerResolved.modelMeta) {
        options.modelMeta = providerResolved.modelMeta;
      }

      return options;
    }

    const openaiOptions: OpenAIAgentRuntimeOptions = {
      ...common,
      type: 'openai'
    };

    return openaiOptions;
  }

  private resolveRuntimeKind(runtime?: RuntimeKind): RuntimeKind {
    return runtime || 'pimono';
  }

  private defaultBaseURL(runtime: RuntimeKind): string {
    if (runtime === 'pimono') {
      return process.env.VITE_LLM_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    }
    return process.env.VITE_LLM_BASE_URL || 'https://api.openai.com/v1';
  }

  private resolveDefaultThinkingLevel(): ThinkingLevel {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { configStoreInstance } = require('@main/common/config/ConfigStore');
      const config = configStoreInstance?.getAll?.();
      const level = config?.models?.defaults?.thinkingLevel;
      if (level) return level as ThinkingLevel;
    } catch {
      // ignore
    }
    return 'medium';
  }

  private resolveProviderBundle(request: AgentRuntimeBuildRequest): {
    model?: string;
    apiKey?: string;
    baseURL?: string;
    modelMeta?: PiMonoAgentRuntimeOptions['modelMeta'];
  } {
    const modelSpec = request.modelOverride || request.model || Models.getDefaultModel();
    const resolved = Models.resolveModel(modelSpec);
    if (!resolved) {
      log.warn(`[AgentRuntimeBuilder] unresolved model: ${modelSpec}`);
      return {};
    }

    const provider = Providers.getProvider(resolved.provider.id);
    if (!provider) {
      log.warn(`[AgentRuntimeBuilder] provider not found: ${resolved.provider.id}`);
      return { model: resolved.model.id };
    }

    const apiKey = resolveApiKey(provider.apiKey, provider.id);
    const modelMeta: PiMonoAgentRuntimeOptions['modelMeta'] = {
      reasoning: resolved.model.reasoning ?? undefined,
      contextWindow: resolved.model.contextWindow ?? undefined,
      maxOutputTokens: resolved.model.maxOutputTokens ?? undefined,
      maxThinkingTokens: resolved.model.maxThinkingTokens ?? undefined,
      functionCalling: resolved.model.functionCalling ?? undefined
    };

    return {
      model: resolved.model.id,
      apiKey,
      baseURL: provider.baseUrl,
      modelMeta
    };
  }
}
