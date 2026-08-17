import type { Logger } from '../logger/Logger';
import type { SessionStore } from '../session/SessionStore';
import type { RunnerCreator } from '../runner/Runner';
import { AudienceDefaultAndHost, ScopeSubagent } from '../types/Scope';
import { ToolCategoryExtension, ToolName, type ToolResult } from '../types/ToolTypes';
import type { ExecContext, Tool, ToolDescriptor } from '../tools/definition/Tool';
import { formatError } from '../tools/builtin/helpers';
import type { SubagentModelPolicy } from './ModelResolve';
import {
  buildSubagentRuntimeInstructions,
  loadToolkitSubagentRefs,
  readSubagentPersonaBody,
  resolveSpawnMode,
  resolveSubagentByKey,
  runInline,
  type SpawnToolDeps
} from './RunInline';

export const SpawnToolDescription =
  'Delegate a task to a child agent run within the current runtime. ' +
  'WHEN TO USE: explicit delegation with clear goals and deliverable. ' +
  'Never pass internal session IDs. Nested spawn is denied.';

function resolvePrompt(params: Record<string, unknown>): string {
  const prompt = typeof params.prompt === 'string' ? params.prompt : '';
  if (prompt.trim()) return prompt.trim();
  const task = typeof params.task === 'string' ? params.task : '';
  return task.trim();
}

export class SpawnSubagentTool implements Tool {
  private readonly deps: SpawnToolDeps;

  constructor(createChild: RunnerCreator, modelPolicy: SubagentModelPolicy, sessions: SessionStore, logger?: Logger) {
    this.deps = { createChild, modelPolicy, sessions, logger };
  }

  descriptor(): ToolDescriptor {
    return {
      name: ToolName.SpawnSubagent,
      description: SpawnToolDescription,
      category: ToolCategoryExtension,
      audience: [...AudienceDefaultAndHost]
    };
  }

  parametersSchema(): Record<string, unknown> {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'delegate', 'prompt'],
      properties: {
        name: { type: 'string' },
        delegate: { type: 'string' },
        prompt: { type: 'string' },
        task: { type: 'string', description: 'Deprecated alias of prompt' },
        subagent_key: { type: 'string' },
        reuse: { type: 'boolean' },
        mode: { type: 'string', enum: ['inline'] }
      }
    };
  }

  async execute(ctx: ExecContext, params: Record<string, unknown>): Promise<ToolResult> {
    if (!this.deps.createChild) {
      return formatError('DEPS_UNAVAILABLE', 'subagent runtime deps unavailable');
    }
    if (!this.deps.sessions) {
      return formatError('DEPS_UNAVAILABLE', 'session storage is not configured for spawn');
    }

    const prompt = resolvePrompt(params);
    const name = typeof params.name === 'string' ? params.name.trim() : '';
    const delegate = typeof params.delegate === 'string' ? params.delegate.trim() : '';
    const reuse = params.reuse === true;

    if (!prompt) return formatError('INVALID_PARAMS', 'prompt is required');
    if (!name) return formatError('INVALID_PARAMS', 'name is required');
    if (!delegate) return formatError('INVALID_PARAMS', 'delegate is required');
    if (ctx.scope === ScopeSubagent) {
      return formatError('NESTED_SUBAGENT_DENIED', 'nested subagent spawn is not allowed');
    }
    if (!ctx.sessionId) return formatError('SESSION_UNAVAILABLE', 'parent session unavailable');

    const modeRaw = typeof params.mode === 'string' ? params.mode : undefined;
    const modeResolved = resolveSpawnMode(modeRaw);
    if (modeResolved.error) return formatError('UNSUPPORTED_MODE', modeResolved.error);

    let subagentKey = typeof params.subagent_key === 'string' ? params.subagent_key.trim() : '';
    let personaPath = '';
    let personaBody = '';
    let instructions = '';

    if (subagentKey) {
      if (!ctx.agentRoot) return formatError('AGENT_ROOT_UNAVAILABLE', 'agent root unavailable');
      const refs = await loadToolkitSubagentRefs(ctx.agentRoot);
      const resolved = resolveSubagentByKey(refs, subagentKey);
      if (!resolved.ok || !resolved.personaPath) {
        return formatError(resolved.code ?? 'SUBAGENT_NOT_FOUND', resolved.message ?? 'subagent not found');
      }
      try {
        personaBody = await readSubagentPersonaBody(ctx.agentRoot, resolved.personaPath!);
      } catch {
        return formatError(
          'SUBAGENT_PERSONA_INVALID',
          `persona markdown invalid or missing for subagent_key ${JSON.stringify(subagentKey)}`
        );
      }
      personaPath = resolved.personaPath!;
      subagentKey = resolved.resolvedKey!;
    }

    const sharedRoot = ctx.sharedSkillsRoot?.trim() || process.env.VESSEL_PLATFORM_SKILLS_ROOT?.trim() || '';
    instructions = buildSubagentRuntimeInstructions(personaBody, ctx.agentRoot, sharedRoot);

    const text = await runInline(
      ctx,
      {
        name,
        delegate,
        reuse,
        task: prompt,
        subagentKey: subagentKey || undefined,
        personaPath: personaPath || undefined,
        mode: modeResolved.mode,
        instructions
      },
      this.deps
    );

    return { success: true, llmContent: text };
  }
}

export async function registerSpawn(
  registry: { register(entry: { tool: Tool; extensionId: string }): Promise<void> },
  createChild: RunnerCreator,
  modelPolicy: SubagentModelPolicy,
  sessions: SessionStore,
  logger?: Logger
): Promise<void> {
  await registry.register({
    tool: new SpawnSubagentTool(createChild, modelPolicy, sessions, logger),
    extensionId: ''
  });
}
