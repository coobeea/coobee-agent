/**
 * OpenAI Agent Builder
 *
 * 链式 API 构建 OpenAIAgentRuntime。
 * 通过 agentExecutor.openai() 获取。
 */

import type { InternalAgentRuntime } from '../AgentRuntime';
import { BaseAgentBuilder, getDefaultSessionDir } from '../BaseAgentBuilder';
import type { AgentRuntimeOptions, SkillDefinition } from '../types';

export class OpenAIBuilder extends BaseAgentBuilder {
  /** 技能列表（累加模式，多次调用会合并） */
  override skills(skills: SkillDefinition[]): this {
    this._skills.push(...skills);
    return this;
  }

  /** 构建并初始化 Runtime */
  override async build(defaultSessionDir?: string): Promise<InternalAgentRuntime> {
    const opts: AgentRuntimeOptions = {
      name: this._name,
      type: 'openai',
      instructions: this._instructions,
      model: this._model || process.env.VITE_LLM_MODEL || 'qwen3-max',
      apiKey: process.env.OPENAI_API_KEY || process.env.VITE_LLM_API_KEY || 'runtime-unset',
      apiType: 'openai-compatible',
      baseURL: process.env.VITE_LLM_BASE_URL || 'https://api.openai.com/v1'
    };

    if (this._appendInstructions.length > 0) opts.appendInstructions = this._appendInstructions;
    if (this._sessionId) opts.sessionId = this._sessionId;
    opts.sessionDir = this._sessionDir || defaultSessionDir || getDefaultSessionDir();
    if (this._tools) opts.tools = this._tools;
    if (this._skills.length) opts.skills = this._skills;
    if (this._maxTurns !== undefined) opts.maxTurns = this._maxTurns;
    if (this._contextDir) opts.contextDir = this._contextDir;
    if (this._workspaceRoot) opts.workspaceRoot = this._workspaceRoot;
    if (this._sandboxContext) opts.sandboxContext = this._sandboxContext;

    const { OpenAIAgentRuntime } = await import('./index');
    const runtime = new OpenAIAgentRuntime(opts);
    await runtime.initialize();

    return runtime;
  }
}
