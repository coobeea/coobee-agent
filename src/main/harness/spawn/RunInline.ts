import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { Logger } from '../logger/Logger';
import { orNop } from '../logger/Logger';
import type { SessionStore } from '../session/SessionStore';
import { DirSubagents } from '../session/SessionStore';
import { EventTypeCatalog } from '../event/spec/EventType';
import type { ExecContext } from '../tools/definition/Tool';
import type { RunnerCreator } from '../runner/Runner';
import { RunnerConfig } from '../runner/RunnerConfig';
import { Signal } from '../types/Signal';
import { ScopeSubagent } from '../types/Scope';
import type { MapperStreamEventType } from '../types/StreamEvent';
import { childSessionRoot } from './ChildSessionRoot';
import { resolveSubagentDelegate } from './DelegateResolve';
import type { SubagentModelPolicy } from './ModelResolve';
import { resolveSubagentModelInput } from './ModelResolve';

export type SpawnMode = 'inline' | 'delegated';

export interface InlineRequest {
  name: string;
  delegate: string;
  reuse: boolean;
  task: string;
  subagentKey?: string;
  personaPath?: string;
  mode: string;
  instructions?: string;
}

export interface InlineResult {
  success: boolean;
  code?: string;
  output?: string;
  error?: string;
  cancelled?: boolean;
  delegate?: string;
  subagent_key?: string;
  reused: boolean;
}

export interface SpawnToolDeps {
  createChild: RunnerCreator;
  modelPolicy: SubagentModelPolicy;
  sessions: SessionStore;
  logger?: Logger;
}

let childRunCounter = 0;

function jsonResult(res: InlineResult): string {
  return JSON.stringify(res);
}

function inlineFailure(code: string, message: string): InlineResult {
  return { success: false, code, error: message, reused: false };
}

function enrichSubagentScope(
  data: Record<string, unknown> | undefined,
  parentSessionId: string,
  childSessionId: string
): Record<string, unknown> {
  return {
    ...(data ?? {}),
    parent_session_id: parentSessionId,
    child_session_id: childSessionId,
    scope: ScopeSubagent
  };
}

function buildSubagentData(
  extra: Record<string, unknown>,
  toolCallId?: string,
  more?: Record<string, unknown>
): Record<string, unknown> {
  const data = { ...extra, ...(more ?? {}) };
  if (toolCallId) data.tool_call_id = toolCallId;
  return data;
}

export async function logUpsertSubagentRecord(
  store: SessionStore,
  parentSessionId: string,
  childSessionId: string,
  patch: Record<string, unknown>,
  op: string,
  logger?: Logger
): Promise<void> {
  if (!store) return;
  try {
    await store.upsertSubagentRecord(parentSessionId, childSessionId, patch);
  } catch (err) {
    orNop(logger ?? null).warn(
      `[spawn] upsert subagent record failed op=${op} parent=${parentSessionId} child=${childSessionId}: ${String(err)}`
    );
  }
}

async function runChildTurn(creator: RunnerCreator, cfg: RunnerConfig): Promise<string> {
  const runner = await creator(cfg);
  return runner.run(Signal.none());
}

/** Executes one inline subagent turn in the current runtime. */
export async function runInline(ctx: ExecContext, req: InlineRequest, deps: SpawnToolDeps): Promise<string> {
  const logger = orNop(deps.logger ?? null);

  if (!ctx.sessionId) {
    return jsonResult(inlineFailure('SESSION_UNAVAILABLE', 'parent session unavailable'));
  }
  if (!deps.createChild) {
    return jsonResult(inlineFailure('DEPS_UNAVAILABLE', 'subagent runtime deps unavailable'));
  }

  const delegate = req.delegate.trim();
  if (!delegate) {
    return jsonResult(inlineFailure('INVALID_PARAMS', 'delegate is required'));
  }

  let resolved;
  try {
    resolved = await resolveSubagentDelegate(deps.sessions, ctx.sessionId, delegate, req.subagentKey ?? '', req.reuse);
  } catch (err) {
    return jsonResult(inlineFailure('DELEGATE_ERROR', err instanceof Error ? err.message : String(err)));
  }

  const childSessionId = resolved.childSessionId;
  const reused = resolved.reused;
  childRunCounter += 1;
  const childRunId = `run_${childRunCounter}`;
  const mode = req.mode || 'inline';

  const spawnMeta: Record<string, unknown> = { delegate, reused };
  if (req.subagentKey) spawnMeta.subagent_key = req.subagentKey;
  if (req.personaPath) spawnMeta.persona_path = req.personaPath;

  const modelInput = resolveSubagentModelInput(ctx.model ?? '', ctx.provider ?? '', deps.modelPolicy);
  const childModel = modelInput.model || ctx.model || '';
  const childProvider = modelInput.provider || ctx.provider || '';
  if (modelInput.flashOptimized) spawnMeta.flash_optimized = true;

  const emit = async (
    childId: string,
    type: MapperStreamEventType,
    content: string,
    data?: Record<string, unknown>
  ): Promise<void> => {
    if (!ctx.streamEmit) return;
    try {
      await ctx.streamEmit(type, content, enrichSubagentScope(data, ctx.sessionId, childId));
    } catch (err) {
      logger.warn(`[spawn] emit subagent event failed type=${type}: ${String(err)}`);
    }
  };

  await emit(
    childSessionId,
    EventTypeCatalog.SubagentSpawnStart,
    req.task,
    buildSubagentData(
      {
        name: req.name,
        task: req.task,
        mode,
        agent_id: ctx.agentId
      },
      ctx.toolCallId,
      spawnMeta
    )
  );

  const childPathCtx = { parentSessionId: ctx.sessionId, scopedChildDir: DirSubagents };
  await deps.sessions.ensureSessionDirs(childSessionId, childPathCtx);

  await emit(
    childSessionId,
    EventTypeCatalog.SubagentSpawnDone,
    'Subagent spawned',
    buildSubagentData(
      {
        child_runtime_id: ctx.runtimeId,
        name: req.name,
        mode,
        run_id: childRunId,
        agent_id: ctx.agentId
      },
      ctx.toolCallId,
      spawnMeta
    )
  );

  const recordPatch: Record<string, unknown> = {
    agent_id: ctx.agentId,
    name: req.name,
    delegate,
    task: req.task,
    mode,
    run_id: childRunId,
    status: 'running',
    reused,
    ...spawnMeta
  };
  await logUpsertSubagentRecord(deps.sessions, ctx.sessionId, childSessionId, recordPatch, 'spawn_running', logger);

  await emit(
    childSessionId,
    EventTypeCatalog.SubagentRunStart,
    'Subagent run started',
    buildSubagentData(
      {
        child_run_id: childRunId
      },
      ctx.toolCallId
    )
  );

  const startedAt = Date.now();
  const childCfg = RunnerConfig.create({
    scope: ScopeSubagent,
    agentId: ctx.agentId,
    agentRoot: ctx.agentRoot,
    workspaceRoot: ctx.workspaceRoot,
    sessionRoot: childSessionRoot(ctx.sessionRoot, childSessionId),
    sessionId: childSessionId,
    parentSessionId: ctx.sessionId,
    scopedChildDir: DirSubagents,
    runId: childRunId,
    runtimeId: ctx.runtimeId,
    userId: ctx.userId,
    message: req.task,
    instructions: req.instructions ?? '',
    model: childModel,
    provider: childProvider,
    contextWindow: ctx.compactionContextWindow ?? 0
  });

  let output = '';
  let runError: Error | undefined;
  try {
    output = await runChildTurn(deps.createChild, childCfg);
  } catch (err) {
    runError = err instanceof Error ? err : new Error(String(err));
  }

  const durationMs = Date.now() - startedAt;

  if (runError) {
    const msg = runError.message;
    await emit(
      childSessionId,
      EventTypeCatalog.SubagentEnd,
      msg,
      buildSubagentData(
        {
          target_kind: 'subagent',
          reason: 'error',
          outcome: 'error',
          error: msg
        },
        ctx.toolCallId
      )
    );
    await logUpsertSubagentRecord(
      deps.sessions,
      ctx.sessionId,
      childSessionId,
      {
        status: 'error',
        outcome: 'error',
        reason: 'error',
        error: msg,
        completed_at: new Date().toISOString()
      },
      'error',
      logger
    );
    return jsonResult({
      success: false,
      code: 'SUBAGENT_ERROR',
      error: msg,
      delegate,
      subagent_key: req.subagentKey,
      reused
    });
  }

  await emit(
    childSessionId,
    EventTypeCatalog.SubagentRunDone,
    output,
    buildSubagentData(
      {
        success: true,
        output,
        duration_ms: durationMs
      },
      ctx.toolCallId
    )
  );

  await emit(
    childSessionId,
    EventTypeCatalog.SubagentEnd,
    'Subagent completed',
    buildSubagentData(
      {
        target_kind: 'subagent',
        reason: 'completed',
        outcome: 'success',
        duration_ms: durationMs
      },
      ctx.toolCallId
    )
  );

  await logUpsertSubagentRecord(
    deps.sessions,
    ctx.sessionId,
    childSessionId,
    {
      status: 'completed',
      outcome: 'success',
      reason: 'completed',
      duration_ms: durationMs,
      completed_at: new Date().toISOString()
    },
    'completed',
    logger
  );

  return jsonResult({
    success: true,
    output,
    delegate,
    subagent_key: req.subagentKey,
    reused
  });
}

export function resolveSpawnMode(mode?: string): { mode: string; error?: string } {
  const normalized = (mode ?? '').trim();
  if (!normalized || normalized === 'inline') return { mode: 'inline' };
  if (normalized === 'delegated') {
    return { mode: '', error: 'mode delegated is not implemented; use inline' };
  }
  return { mode: '', error: `unsupported spawn mode ${JSON.stringify(normalized)}` };
}

export interface ToolkitSubagentRef {
  key?: string;
  path?: string;
  enabled?: boolean;
}

export function resolveSubagentByKey(
  refs: ToolkitSubagentRef[],
  subagentKey: string
): { ok: boolean; code?: string; message?: string; personaPath?: string; resolvedKey?: string } {
  const key = subagentKey.trim();
  if (!key) return { ok: false, code: 'INVALID_SUBAGENT_KEY', message: 'subagent_key is required' };
  for (const ref of refs) {
    const refPath = ref.path ?? '';
    const refKey = ref.key?.trim() || path.basename(refPath, path.extname(refPath));
    if (refKey !== key) continue;
    if (!refPath) continue;
    if (ref.enabled === false) {
      return {
        ok: false,
        code: 'SUBAGENT_DISABLED',
        message: `subagent_key ${JSON.stringify(key)} is disabled in config`
      };
    }
    return { ok: true, personaPath: ref.path, resolvedKey: key };
  }
  return {
    ok: false,
    code: 'SUBAGENT_NOT_FOUND',
    message: `subagent_key ${JSON.stringify(key)} is not registered in toolkit.subagents`
  };
}

export async function readSubagentPersonaBody(agentRoot: string, relPath: string): Promise<string> {
  const p = relPath.trim();
  if (!p) throw new Error('empty persona path');
  const abs = path.isAbsolute(p) ? p : path.join(agentRoot, p);
  const data = await readFile(path.normalize(abs), 'utf8');
  const body = data.trim();
  if (!body) throw new Error('empty persona body');
  return body;
}

/** Delegates to config.Load toolkit.subagents. */
export async function loadToolkitSubagentRefs(agentRoot: string): Promise<ToolkitSubagentRef[]> {
  const { loadToolkitSubagentRefs: load } = await import('../config/ConfigLoader');
  const refs = await load(agentRoot);
  return refs.map((r) => ({
    key: r.key,
    path: r.path,
    enabled: r.enabled
  }));
}

export function buildSubagentRuntimeInstructions(
  personaBody: string,
  _agentRoot: string,
  _sharedSkillsRoot: string
): string {
  const parts: string[] = [];
  if (personaBody.trim()) parts.push(personaBody.trim());
  return parts.join('\n\n');
}
