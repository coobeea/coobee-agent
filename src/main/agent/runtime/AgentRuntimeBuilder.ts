import type { AgentRuntimeOptions } from './types';
import type { AgentRuntimeKind } from './types';
import type { AgentRuntime } from './AgentRuntime';
import { PiMonoAgentRuntime } from './pimono/PiMonoAgentRuntime';
import { OpenAIAgentRuntime } from './openai/OpenAIAgentRuntime';
import type { SkillDefinition } from './types';

/**
 * AgentRuntimeBuilder（参数构造器）
 *
 * 只做一件事：根据上层请求 + provider 配置，产出最终 RuntimeOptions。
 */
export class AgentRuntimeBuilder {
  private options: AgentRuntimeOptions;

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

  setName(name: string): this {
    this.options.name = name;
    return this;
  }

  setType(type: AgentRuntimeKind): this {
    this.options.type = type;
    return this;
  }

  setInstructions(instructions: string): this {
    this.options.instructions = instructions;
    return this;
  }

  setAppendInstructions(appendInstructions: string[]): this {
    this.options.appendInstructions = appendInstructions;
    return this;
  }

  setSkills(skills: SkillDefinition[]): this {
    this.options.skills = skills;
    return this;
  }

  setSessionId(sessionId: string): this {
    this.options.sessionId = sessionId;
    return this;
  }

  setSessionMode(sessionMode: 'memory' | 'file'): this {
    this.options.sessionMode = sessionMode;
    return this;
  }

  setSessionDir(sessionDir: string): this {
    this.options.sessionDir = sessionDir;
    return this;
  }

  setTools(tools: ToolDefinition[]): this {
    this.options.tools = tools;
    return this;
  }

  setMaxTurns(maxTurns: number): this {
    this.options.maxTurns = maxTurns;
    return this;
  }

  setContextDir(contextDir: string): this {
    this.options.contextDir = contextDir;
    return this;
  }

  setWorkspaceRoot(workspaceRoot: string): this {
    this.options.workspaceRoot = workspaceRoot;
    return this;
  }

  setSandboxContext(sandboxContext: import('../tools/types').ToolExecutionContext): this {
    this.options.sandboxContext = sandboxContext;
    return this;
  }

  setSignal(signal: AbortSignal): this {
    this.options.signal = signal;
    return this;
  }

  setModel(model: string): this {
    this.options.model = model;
    return this;
  }

  setApiKey(apiKey: string): this {
    this.options.apiKey = apiKey;
    return this;
  }

  setApiType(apiType: 'openai-compatible'): this {
    this.options.apiType = apiType;
    return this;
  }

  setBaseURL(baseURL: string): this {
    this.options.baseURL = baseURL;
    return this;
  }

  setThinkingLevel(thinkingLevel: ThinkingLevel): this {
    this.options.thinkingLevel = thinkingLevel;
    return this;
  }

  setCompaction(compaction: { enabled?: boolean }): this {
    this.options.compaction = compaction;
    return this;
  }

  setRetry(retry: { enabled?: boolean; maxRetries?: number; baseDelayMs?: number }): this {
    this.options.retry = retry;
    return this;
  }

  build(): AgentRuntime {
    if (this.options.type === 'pi-mono') {
      return new PiMonoAgentRuntime(this.options);
    } else if (this.options.type === 'openai') {
      return new OpenAIAgentRuntime(this.options);
    }
    throw new Error(`Unsupported runtime type: ${this.options.type}`);
  }
}
