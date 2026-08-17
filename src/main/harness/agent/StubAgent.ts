import type { StreamEvent } from '../types/StreamEvent';
import type { Agent } from './Agent';
import { Identity } from './Identity';
import type { AgentOptions } from './AgentOptions';
import type { AgentInput } from './Input';
import type { Description } from './Description';

/**
 * Stub Agent：产出固定 Mapper 流事件，用于打通编排。
 */
export class StubAgent implements Agent {
  private readonly id: Identity;
  private readonly defaults: AgentOptions;

  constructor(opts: AgentOptions) {
    this.defaults = opts;
    this.id = new Identity({
      scope: opts.scope,
      runtimeId: opts.runtimeId,
      agentId: opts.agentId,
      userId: opts.userId,
      sessionId: opts.sessionId,
      parentSessionId: opts.parentSessionId,
      scopedChildDir: opts.scopedChildDir,
      agentRoot: opts.agentRoot,
      workspaceRoot: opts.workspaceRoot,
      sessionRoot: opts.sessionRoot,
      sharedSkillsRoot: opts.sharedSkillsRoot
    });
  }

  identity(): Identity {
    return this.id;
  }

  async describeRun(input: AgentInput): Promise<Description> {
    const model = input.model || this.defaults.defaultModel || 'stub-model';
    const provider = input.provider || this.defaults.defaultProvider || 'stub';
    const thinking = input.thinkingLevel || this.defaults.defaultThinkingLevel || 'off';
    const instructions =
      input.replaceSystemPrompt || input.instructions || this.defaults.instructions || 'You are a stub agent.';

    return {
      profile: {
        agentId: this.id.agentId,
        name: 'stub',
        defaultModel: this.defaults.defaultModel,
        defaultProvider: this.defaults.defaultProvider,
        instructionAssembly: {
          effective: instructions,
          sources: { stub: 'stub' }
        }
      },
      selectedModel: model,
      provider,
      thinkingLevel: thinking,
      generation: {
        temperature: input.temperature ?? this.defaults.defaultTemperature
      },
      contextWindow: input.contextWindow || this.defaults.compactionContextWindow || 128000,
      sessionMetadata: null
    };
  }

  async *stream(input: AgentInput, _desc: Description): AsyncIterable<StreamEvent> {
    const text = `stub-reply: ${input.message}`;
    yield { type: 'turn:start', data: { turn_index: 0 } };
    yield { type: 'llm:start', data: {} };
    yield { type: 'text:start', content: '' };
    yield { type: 'text:delta', content: text };
    yield { type: 'text:done', content: text };
    yield {
      type: 'llm:done',
      data: {
        usage: { input_tokens: 1, output_tokens: text.length, total_tokens: 1 + text.length }
      }
    };
    yield { type: 'turn:done', data: { turn_index: 0 } };
  }
}
