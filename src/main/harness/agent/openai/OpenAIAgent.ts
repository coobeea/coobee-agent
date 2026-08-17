import type OpenAI from 'openai';
import type { Agent } from '../Agent';
import { Identity } from '../Identity';
import type { AgentOptions } from '../AgentOptions';
import type { AgentInput } from '../Input';
import type { Description } from '../Description';
import type { StreamEvent } from '../../types/StreamEvent';
import type { Logger } from '../../logger/Logger';
import { orNop } from '../../logger/Logger';
import type { ToolRegistry } from '../../tools/ToolRegistry';
import type { SessionStore } from '../../session/SessionStore';
import type { ModelProvider } from '../../model/ModelProvider';
import { DefaultAssembler } from '../../prompt/PromptBuilder';
import {
  loadAgentProfile,
  loadConfig,
  resolveGenerationSettings,
  resolveSharedSkillsRoot
} from '../../config/ConfigLoader';
import type { ExecContext } from '../../tools/definition/Tool';
import type { Tool } from '../../tools/definition/Tool';
import { ScopeSubagent } from '../../types/Scope';
import { maybeCompactSession } from './Compaction';

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface OpenAIAgentDeps {
  modelProvider: ModelProvider;
  toolRegistry: ToolRegistry;
  sessionStore: SessionStore;
  logger?: Logger;
  maxToolRounds?: number;
}

class AgentExecContext implements ExecContext {
  readonly agentRoot: string;
  readonly workspaceRoot: string;
  readonly sessionRoot: string;
  readonly sharedSkillsRoot?: string;
  readonly runtimeId: string;
  readonly agentId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly scope: ExecContext['scope'];
  readonly model?: string;
  readonly provider?: string;
  readonly streamEmit?: ExecContext['streamEmit'];
  readonly emitStandardEvent?: ExecContext['emitStandardEvent'];
  toolCallId?: string;

  constructor(
    id: Identity,
    run: {
      runId: string;
      model?: string;
      provider?: string;
      streamEmit?: ExecContext['streamEmit'];
      emitStandardEvent?: ExecContext['emitStandardEvent'];
    }
  ) {
    this.agentRoot = id.agentRoot;
    this.workspaceRoot = id.workspaceRoot;
    this.sessionRoot = id.sessionRoot;
    this.sharedSkillsRoot = id.sharedSkillsRoot;
    this.runtimeId = id.runtimeId;
    this.agentId = id.agentId;
    this.userId = id.userId;
    this.sessionId = id.sessionId;
    this.runId = run.runId;
    this.scope = id.scope;
    this.model = run.model;
    this.provider = run.provider;
    this.streamEmit = run.streamEmit;
    this.emitStandardEvent = run.emitStandardEvent;
  }

  cwdOrWorkspace(): string {
    return this.workspaceRoot || this.agentRoot || process.cwd();
  }
}

/**
 * OpenAI-compatible Agent：DescribeRun 装配置/提示词，Stream 跑多轮 tool loop。
 */
export class OpenAIAgent implements Agent {
  private readonly id: Identity;
  private readonly opts: AgentOptions;
  private readonly deps: OpenAIAgentDeps;
  private readonly logger: Logger;

  constructor(opts: AgentOptions, deps: OpenAIAgentDeps) {
    this.opts = opts;
    this.deps = deps;
    this.logger = orNop(deps.logger);
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
    const shared = resolveSharedSkillsRoot(this.opts.sharedSkillsRoot);
    const profile = await loadAgentProfile(this.id.agentRoot, this.id.agentId, shared, new DefaultAssembler());
    const loaded = await loadConfig(this.id.agentRoot);
    const gen = resolveGenerationSettings({
      configDefaults: loaded.doc.llm?.generation_defaults,
      harnessDefaults: {
        temperature: this.opts.defaultTemperature,
        thinkingLevel: this.opts.defaultThinkingLevel
      },
      runOverrides: {
        temperature: input.temperature,
        thinkingLevel: input.thinkingLevel
      }
    });

    const selectedModel =
      input.model?.trim() || this.opts.defaultModel?.trim() || profile.defaultModel || 'gpt-4o-mini';
    const provider = input.provider?.trim() || this.opts.defaultProvider?.trim() || profile.defaultProvider || 'openai';

    let system =
      input.replaceSystemPrompt?.trim() ||
      input.instructions?.trim() ||
      this.opts.instructions?.trim() ||
      profile.instructionAssembly.effective;

    if (input.prependContext) {
      system = `${input.prependContext}\n\n${system}`;
    }
    if (input.appendContext) {
      system = `${system}\n\n${input.appendContext}`;
    }

    return {
      profile: {
        agentId: profile.agentId,
        name: profile.name,
        defaultModel: profile.defaultModel,
        defaultProvider: profile.defaultProvider,
        instructionAssembly: {
          effective: system,
          sources: profile.instructionAssembly.sources
        }
      },
      selectedModel,
      provider,
      thinkingLevel: gen.thinkingLevel,
      generation: { temperature: gen.temperature },
      contextWindow: input.contextWindow || this.opts.compactionContextWindow || 128000,
      sessionMetadata: null
    };
  }

  async *stream(input: AgentInput, desc: Description): AsyncIterable<StreamEvent> {
    const client = (await this.deps.modelProvider.buildClient({
      backend: 'openai',
      baseURL: this.opts.defaultBaseUrl || process.env.OPENAI_BASE_URL || '',
      apiKey: this.opts.defaultApiKey || process.env.OPENAI_API_KEY || '',
      modelName: desc.selectedModel,
      provider: desc.provider,
      thinkingLevel: desc.thinkingLevel
    })) as OpenAI;

    const tools = this.buildToolDefs();
    const messages: ChatMessage[] = [
      { role: 'system', content: desc.profile.instructionAssembly?.effective || 'You are a helpful assistant.' },
      { role: 'user', content: input.message }
    ];

    const maxRounds = this.deps.maxToolRounds ?? 12;
    let turnIndex = 0;

    yield { type: 'run:start', data: { model: desc.selectedModel, provider: desc.provider } };

    // compaction before LLM (best-effort)
    try {
      const compacted = await maybeCompactSession({
        store: this.deps.sessionStore,
        sessionId: this.id.sessionId,
        contextWindow: desc.contextWindow,
        thresholdRatio: this.opts.compactionThresholdRatio ?? 0.75,
        keepRatio: this.opts.compactionKeepRatio ?? 0.5,
        minMessages: this.opts.compactionMinMessageCount ?? 20,
        debug: this.opts.compactionDebug
      });
      if (compacted) {
        yield { type: 'compaction:start', data: compacted };
        yield { type: 'compaction:done', data: compacted };
      }
    } catch (err) {
      this.logger.warn(`[openai-agent] compaction skipped: ${String(err)}`);
    }

    for (let round = 0; round < maxRounds; round++) {
      yield { type: 'turn:start', data: { turn_index: turnIndex } };
      yield { type: 'llm:start', data: { model: desc.selectedModel } };

      let assistantText = '';
      const toolCalls: Array<{
        id: string;
        name: string;
        arguments: string;
      }> = [];

      const stream = await client.chat.completions.create({
        model: desc.selectedModel,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        temperature: desc.generation?.temperature,
        stream: true,
        stream_options: { include_usage: true }
      });

      let usage: Record<string, unknown> | undefined;
      const pendingArgs = new Map<number, { id: string; name: string; arguments: string }>();

      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        const delta = choice?.delta;
        if (chunk.usage) {
          usage = {
            input_tokens: chunk.usage.prompt_tokens,
            output_tokens: chunk.usage.completion_tokens,
            total_tokens: chunk.usage.total_tokens
          };
        }
        if (delta?.content) {
          if (!assistantText) {
            yield { type: 'text:start', content: '' };
          }
          assistantText += delta.content;
          yield { type: 'text:delta', content: delta.content };
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const cur = pendingArgs.get(idx) ?? { id: '', name: '', arguments: '' };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name = tc.function.name;
            if (tc.function?.arguments) cur.arguments += tc.function.arguments;
            pendingArgs.set(idx, cur);
          }
        }
      }

      for (const tc of pendingArgs.values()) {
        if (tc.id && tc.name) toolCalls.push(tc);
      }

      if (assistantText) {
        yield { type: 'text:done', content: assistantText };
      }
      yield { type: 'llm:done', data: { usage } };
      yield { type: 'turn:done', data: { turn_index: turnIndex } };
      turnIndex += 1;

      if (toolCalls.length === 0) {
        break;
      }

      messages.push({
        role: 'assistant',
        content: assistantText || null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments || '{}' }
        }))
      });

      for (const tc of toolCalls) {
        yield {
          type: 'tool:start',
          content: '',
          data: { tool_name: tc.name, call_id: tc.id, arguments: tc.arguments }
        };

        let params: Record<string, unknown> = {};
        try {
          params = JSON.parse(tc.arguments || '{}') as Record<string, unknown>;
        } catch {
          params = {};
        }

        const mapperEvents: StreamEvent[] = [];
        const execCtx = new AgentExecContext(this.id, {
          runId: input.requestId || 'run',
          model: desc.selectedModel,
          provider: desc.provider,
          streamEmit: async (type, content, data) => {
            mapperEvents.push({
              type: type as StreamEvent['type'],
              content,
              data
            });
          },
          emitStandardEvent: async () => {
            // orchestrate owns standard emit; tool may call via streamEmit path
          }
        });
        execCtx.toolCallId = tc.id;

        const tool = this.deps.toolRegistry.get(tc.name);
        let resultText = '';
        if (!tool) {
          resultText = JSON.stringify({
            success: false,
            error: { code: 'TOOL_NOT_FOUND', message: `unknown tool: ${tc.name}` }
          });
        } else {
          const result = await this.deps.toolRegistry.getPipeline().run(tool, execCtx, params);
          resultText = result.llmContent || result.userContent || JSON.stringify(result);
        }

        for (const ev of mapperEvents) {
          yield ev;
        }

        yield {
          type: 'tool:done',
          content: resultText,
          data: { tool_name: tc.name, call_id: tc.id }
        };

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: resultText
        });
      }
    }

    // nested subagents cannot spawn further — already enforced in spawn tool
    void ScopeSubagent;
  }

  private buildToolDefs(): OpenAI.Chat.Completions.ChatCompletionTool[] {
    const entries = this.deps.toolRegistry.entriesForAgent(this.id.scope);
    return entries.map((e) => {
      const d = e.tool.descriptor();
      const schema = readParametersSchema(e.tool);
      return {
        type: 'function' as const,
        function: {
          name: d.name,
          description: d.description,
          parameters: schema as OpenAI.FunctionParameters
        }
      };
    });
  }
}

function readParametersSchema(tool: Tool): Record<string, unknown> {
  const withSchema = tool as Tool & { parametersSchema?: () => Record<string, unknown> };
  if (typeof withSchema.parametersSchema === 'function') {
    return withSchema.parametersSchema();
  }
  return { type: 'object', properties: {} };
}
