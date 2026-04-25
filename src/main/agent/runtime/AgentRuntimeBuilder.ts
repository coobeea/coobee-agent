import type { ProviderConfig } from '@main/agent/provider/types';

import { resolveApiKey } from '../provider/ApiKeyResolver';
import type { ToolExecutionContext } from '../tools/types';
import type { AgentRuntimeKind, AgentRuntimeOptions, AgentMode, ThinkingLevel } from './types';
import type { AgentRuntime } from './AgentRuntime';
import { PiMonoAgentRuntime } from './pimono/PiMonoAgentRuntime';
import { OpenAIAgentRuntime } from './openai/OpenAIAgentRuntime';
import type { SkillDefinition, ToolDefinition } from './types';

/**
 * AgentRuntimeBuilder（参数构造器）
 *
 * 只做一件事：根据上层请求 + provider 配置，产出最终 RuntimeOptions。
 */
export class AgentRuntimeBuilder {
  private options: AgentRuntimeOptions;
  private _mode: AgentMode = 'agent';
  private _lightweight = false;
  private _agentId?: string;
  private _providerConfig?: ProviderConfig;
  private _providerModelId?: string;

  constructor() {
    this.options = {
      name: 'agent',
      type: 'pi-mono',
      instructions: '',
      model: '',
      apiKey: '',
      apiType: 'openai-compatible',
      baseURL: ''
    };
  }

  mode(m: AgentMode): this {
    this._mode = m;
    return this;
  }

  getMode(): AgentMode {
    return this._mode;
  }

  lightweight(enabled: boolean): this {
    this._lightweight = enabled;
    return this;
  }

  getLightweight(): boolean {
    return this._lightweight;
  }

  agentId(id: string): this {
    this._agentId = id;
    return this;
  }

  getAgentId(): string | undefined {
    return this._agentId;
  }

  name(name: string): this {
    this.options.name = name;
    return this;
  }

  getName(): string {
    return this.options.name;
  }

  type(type: AgentRuntimeKind): this {
    this.options.type = type;
    return this;
  }

  instructions(instructions: string): this {
    this.options.instructions = instructions;
    return this;
  }

  appendInstructions(...appendInstructions: string[]): this {
    this.options.appendInstructions = [...(this.options.appendInstructions || []), ...appendInstructions];
    return this;
  }

  skills(skills: SkillDefinition[]): this {
    this.options.skills = [...(this.options.skills || []), ...skills];
    return this;
  }

  sessionId(sessionId: string): this {
    this.options.sessionId = sessionId;
    return this;
  }

  sessionMode(sessionMode: 'memory' | 'file'): this {
    this.options.sessionMode = sessionMode;
    return this;
  }

  sessionDir(sessionDir: string): this {
    this.options.sessionDir = sessionDir;
    return this;
  }

  tools(tools: ToolDefinition[]): this {
    this.options.tools = tools;
    return this;
  }

  maxTurns(maxTurns: number): this {
    this.options.maxTurns = maxTurns;
    return this;
  }

  contextDir(contextDir: string): this {
    this.options.contextDir = contextDir;
    return this;
  }

  workspaceRoot(workspaceRoot: string): this {
    this.options.workspaceRoot = workspaceRoot;
    return this;
  }

  getWorkspaceRoot(): string | undefined {
    return this.options.workspaceRoot;
  }

  sandboxContext(sandboxContext: ToolExecutionContext): this {
    this.options.sandboxContext = sandboxContext;
    return this;
  }

  signal(signal: AbortSignal): this {
    this.options.signal = signal;
    return this;
  }

  model(model: string): this {
    this.options.model = model;
    return this;
  }

  apiKey(apiKey: string): this {
    this.options.apiKey = apiKey;
    return this;
  }

  apiType(apiType: 'openai-compatible'): this {
    this.options.apiType = apiType;
    return this;
  }

  baseURL(baseURL: string): this {
    this.options.baseURL = baseURL;
    return this;
  }

  thinkingLevel(thinkingLevel: ThinkingLevel): this {
    this.options.thinkingLevel = thinkingLevel;
    return this;
  }

  compaction(compaction: { enabled?: boolean }): this {
    this.options.compaction = compaction;
    return this;
  }

  retry(retry: { enabled?: boolean; maxRetries?: number; baseDelayMs?: number }): this {
    this.options.retry = retry;
    return this;
  }

  fromProviderConfig(config: ProviderConfig, modelId?: string): this {
    this._providerConfig = config;
    this._providerModelId = modelId;
    return this;
  }

  private resolveApiKey(): string {
    if (this.options.apiKey) return this.options.apiKey;
    if (this._providerConfig?.apiKey) {
      const fromProvider = resolveApiKey(this._providerConfig.apiKey, this._providerConfig.id);
      if (fromProvider) return fromProvider;
    }
    return process.env.DASHSCOPE_API_KEY || process.env.OPENAI_API_KEY || process.env.VITE_LLM_API_KEY || '';
  }

  private resolveModel(): string {
    if (this.options.model) return this.options.model;
    if (this._providerModelId) return this._providerModelId;
    return process.env.VITE_LLM_MODEL || 'qwen3-max';
  }

  private resolveBaseURL(): string {
    if (this.options.baseURL) return this.options.baseURL;
    if (this._providerConfig?.baseUrl) return this._providerConfig.baseUrl;
    return this.options.type === 'pi-mono'
      ? process.env.VITE_LLM_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
      : process.env.VITE_LLM_BASE_URL || 'https://api.openai.com/v1';
  }

  async build(): Promise<AgentRuntime> {
    const resolved: AgentRuntimeOptions = {
      ...this.options,
      model: this.resolveModel(),
      apiKey: this.resolveApiKey(),
      baseURL: this.resolveBaseURL()
    };

    if (!resolved.apiKey) {
      throw new Error('API Key 未配置');
    }

    let runtime: AgentRuntime;
    if (this.options.type === 'pi-mono') {
      runtime = new PiMonoAgentRuntime(resolved);
    } else if (this.options.type === 'openai') {
      runtime = new OpenAIAgentRuntime(resolved);
    } else {
      throw new Error(`Unsupported runtime type: ${this.options.type}`);
    }

    if ('initialize' in runtime && typeof runtime.initialize === 'function') {
      await runtime.initialize();
    }
    return runtime;
  }
}
