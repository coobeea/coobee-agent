import type { Agent } from '../agent/Agent';
import type { AgentInput } from '../agent/Input';
import type { Description } from '../agent/Description';
import { EventTypeCatalog } from '../event/spec/EventType';
import { HookName } from '../extension/hook/HookName';
import type { HookIdentity, HookRunDeps, ModelBinding, SessionReader } from '../extension/hook/HookRunner';
import type { Logger } from '../logger/Logger';
import { orNop } from '../logger/Logger';
import type { Signal } from '../types/Signal';
import type { StreamEvent } from '../types/StreamEvent';
import { normalizeUsageForEvent } from '../types/TokenUsage';
import type { Orchestrator } from './Orchestrator';
import { RunDeps, type RunRequest, withDefaultPolicy } from './RunDeps';
import { RunState } from './RunState';
import { RunStore } from './RunStore';

class EmptySessionReader implements SessionReader {
  async readRecentDialogue(): Promise<[]> {
    return [];
  }
}

class PerRunHookDeps implements HookRunDeps {
  private binding: ModelBinding = { model: '', provider: '' };

  constructor(
    private readonly identityValue: HookIdentity,
    private readonly policy: ReturnType<typeof withDefaultPolicy>,
    private readonly emitFn: (type: string, content: string, data?: unknown) => Promise<void>
  ) {}

  identity(): HookIdentity {
    return this.identityValue;
  }

  policyDefaults(): ReturnType<typeof withDefaultPolicy> {
    return this.policy;
  }

  session(): SessionReader {
    return new EmptySessionReader();
  }

  async emit(eventType: string, content: string, data?: unknown): Promise<void> {
    await this.emitFn(eventType, content, data);
  }

  resolvedModelBinding(): ModelBinding {
    return this.binding;
  }

  setResolvedModelBinding(binding: ModelBinding): void {
    this.binding = {
      model: binding.model || this.binding.model,
      provider: binding.provider || this.binding.provider
    };
  }
}

/**
 * 默认编排器：head → prepare → stream → finish*。
 */
export class DefaultOrchestrator implements Orchestrator {
  async run(signal: Signal, agent: Agent, request: RunRequest): Promise<string> {
    const execution = new TurnExecution(signal, agent, request);
    return execution.execute();
  }
}

class TurnExecution {
  private readonly state = new RunState();
  private readonly store: RunStore;
  private readonly deps: RunDeps;
  private readonly logger: Logger;
  private description: Description | null = null;
  private input: AgentInput | null = null;

  constructor(
    private readonly signal: Signal,
    private readonly agent: Agent,
    private readonly request: RunRequest
  ) {
    this.deps = request.deps;
    this.logger = orNop(this.deps.logger);
    this.store = new RunStore(request.runId);
  }

  async execute(): Promise<string> {
    try {
      await this.head();
      const early = await this.prepare();
      if (early !== null) {
        return early;
      }
      await this.stream();
      if (this.state.cancelled || this.signal.aborted) {
        return this.finishCancelled();
      }
      if (this.state.failed) {
        return this.finishFailed(this.state.failed);
      }
      if (this.state.pendingTools > 0) {
        return this.finishFailed(new Error('orchestrate: pending tools after stream'));
      }
      return this.finishSuccess();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (this.signal.aborted) {
        return this.finishCancelled();
      }
      return this.finishFailed(error);
    } finally {
      try {
        const { getBackgroundStore } = await import('../tools/builtin/BackgroundStore');
        getBackgroundStore().purgeSession(this.request.sessionId);
      } catch {
        // ignore
      }
    }
  }

  private async head(): Promise<void> {
    await this.deps.sessions.ensureSessionDirs(this.request.sessionId, {
      parentSessionId: this.request.parentSessionId,
      scopedChildDir: this.request.scopedChildDir
    });

    this.bindHookDeps();

    await this.deps.hooks.runSoftVoid(HookName.MessageReceived, {
      message: this.request.message,
      session_id: this.request.sessionId,
      skip_input_policy: this.request.skipInputPolicy
    });

    await this.emit(EventTypeCatalog.UserInput, this.request.message, {
      session_id: this.request.sessionId,
      request_id: this.request.requestId
    });

    this.logger.debug(`[orchestrate] head done session=${this.request.sessionId} run=${this.request.runId}`);
  }

  private async prepare(): Promise<string | null> {
    this.signal.throwIfAborted();

    const prepInput = await this.deps.hooks.runModifying(HookName.PrepareRunInput, {
      message: this.request.message,
      skip_input_policy: this.request.skipInputPolicy
    });
    if (prepInput?.block) {
      return this.finishBlocked(String(prepInput.reason ?? 'blocked by prepare_run_input'));
    }

    let message = this.request.message;
    const userPrepend = typeof prepInput?.prepend_context === 'string' ? prepInput.prepend_context : '';
    const userAppend = typeof prepInput?.append_context === 'string' ? prepInput.append_context : '';
    if (userPrepend) message = `${userPrepend}${message}`;
    if (userAppend) message = `${message}${userAppend}`;

    // 用户消息前缀：session_environment + system_time（prefix-cache 友好，不进 system）
    const { buildSessionEnvironmentBlock, buildSystemTimeBlock } = await import('../prompt/PromptBuilder');
    const id = this.agent.identity();
    const envBlock = buildSessionEnvironmentBlock(
      this.request.workspaceRoot || id.workspaceRoot,
      this.request.sessionRoot || id.sessionRoot,
      this.request.agentRoot || id.agentRoot
    );
    const timeBlock = buildSystemTimeBlock();
    const prefixes = [envBlock, timeBlock].filter((s) => s.trim());
    if (prefixes.length > 0) {
      message = `${prefixes.join('\n\n')}\n\n${message}`;
    }

    const modelResolve = await this.deps.hooks.runModifying(HookName.PrepareModelResolve, {
      model: this.request.model,
      provider: this.request.provider,
      thinking_level: this.request.thinkingLevel
    });

    const agentRun = await this.deps.hooks.runModifying(HookName.PrepareAgentRun, {
      message
    });
    if (agentRun?.outcome === 'block' || agentRun?.block) {
      return this.finishBlocked(String(agentRun.reason ?? 'blocked by prepare_agent_run'));
    }

    const agentReply = await this.deps.hooks.runModifying(HookName.PrepareAgentReply, {
      message
    });
    if (agentReply?.handled) {
      return this.finishShortReply(String(agentReply.reply ?? agentReply.final_output ?? ''));
    }

    this.input = {
      requestId: this.request.requestId,
      message,
      model: (modelResolve?.model as string) || this.request.model,
      provider: (modelResolve?.provider as string) || this.request.provider,
      thinkingLevel: (modelResolve?.thinking_level as string) || this.request.thinkingLevel,
      temperature: this.request.temperature,
      instructions: this.request.instructions,
      appendContext: this.request.systemAppend,
      replaceSystemPrompt:
        typeof prepInput?.replace_system_prompt === 'string' ? prepInput.replace_system_prompt : undefined,
      contextWindow: this.request.contextWindow
    };

    this.description = await this.agent.describeRun(this.input);
    this.store.hookDeps?.setResolvedModelBinding({
      model: this.description.selectedModel,
      provider: this.description.provider
    });

    this.signal.throwIfAborted();
    return null;
  }

  private async stream(): Promise<void> {
    if (!this.input || !this.description) {
      throw new Error('orchestrate: prepare did not produce input/description');
    }

    await this.deps.hooks.runSoftVoid(HookName.RunStarted, {
      run_id: this.request.runId,
      model: this.description.selectedModel,
      provider: this.description.provider
    });

    await this.emit(EventTypeCatalog.RunStart, '', {
      run_id: this.request.runId,
      model: this.description.selectedModel,
      provider: this.description.provider
    });

    for await (const ev of this.agent.stream(this.input, this.description)) {
      if (this.signal.aborted) {
        this.state.cancelled = true;
        break;
      }
      await this.consumeMapperEvent(ev);
    }
  }

  private async consumeMapperEvent(ev: StreamEvent): Promise<void> {
    if (ev.type === 'stream:error') {
      this.state.failed = new Error(ev.content || 'stream error');
      return;
    }
    if (ev.type === 'run:done') {
      // 编排层规范：延后到 finish 统一 emit
      return;
    }

    if (ev.type === 'turn:start') {
      await this.deps.hooks.runSoftVoid(HookName.TurnStarted, {
        turn_index: ev.data?.turn_index
      });
    }

    let content = ev.content ?? '';
    let data = ev.data ? { ...ev.data } : {};
    let drop = false;

    if (ev.type.startsWith('tool:')) {
      const transformed = await this.deps.hooks.runModifying(HookName.TransformToolEvent, {
        type: ev.type,
        content,
        data
      });
      if (transformed?.drop) drop = true;
      if (typeof transformed?.content === 'string') content = transformed.content;
      if (transformed?.data && typeof transformed.data === 'object') {
        data = transformed.data as Record<string, unknown>;
      }
    }

    if (ev.type.startsWith('reasoning:')) {
      const transformed = await this.deps.hooks.runModifying(HookName.TransformReasoningEvent, {
        type: ev.type,
        content,
        data
      });
      if (transformed?.drop) drop = true;
      if (typeof transformed?.content === 'string') content = transformed.content;
      if (transformed?.data && typeof transformed.data === 'object') {
        data = transformed.data as Record<string, unknown>;
      }
    }

    this.state.applyStreamEvent(ev.type, content, data);

    if (!drop) {
      await this.emit(ev.type as typeof EventTypeCatalog.TextDelta, content, data);
    }

    if (ev.type === 'compaction:start') {
      await this.deps.hooks.runSoftVoid(HookName.CompactionStarted, data);
    }
    if (ev.type === 'compaction:done') {
      await this.deps.hooks.runSoftVoid(HookName.CompactionCompleted, data);
    }
    if (ev.type === 'turn:done') {
      await this.deps.hooks.runSoftVoid(HookName.TurnCompleted, {
        turn_index: data.turn_index ?? this.state.turnIndex
      });
    }
  }

  private async finishSuccess(): Promise<string> {
    let finalOutput = this.state.assistantText;
    const finalized = await this.deps.hooks.runModifying(HookName.PrepareAgentFinalize, {
      final_output: finalOutput
    });
    if (typeof finalized?.final_output === 'string') {
      finalOutput = finalized.final_output;
      this.state.assistantText = finalOutput;
    }

    await this.deps.hooks.runSoftVoid(HookName.TurnCompleted, {
      final: true,
      content: finalOutput
    });

    await this.emit(EventTypeCatalog.RunDone, finalOutput, {
      reason: 'completed',
      usage: normalizeUsageForEvent(this.state.usage)
    });

    await this.deps.sessions.writeMetadata(
      this.request.sessionId,
      {
        run_status: 'completed',
        last_run_id: this.request.runId
      },
      {
        parentSessionId: this.request.parentSessionId,
        scopedChildDir: this.request.scopedChildDir
      }
    );

    await this.deps.hooks.runSoftVoid(HookName.RunCompleted, {
      run_id: this.request.runId,
      final_output: finalOutput
    });

    return finalOutput;
  }

  private async finishCancelled(): Promise<string> {
    if (this.state.assistantText) {
      await this.emit(EventTypeCatalog.TextDone, this.state.assistantText, {});
    }
    await this.emit(EventTypeCatalog.RunDone, this.state.assistantText, { reason: 'cancelled' });
    await this.deps.sessions.writeMetadata(
      this.request.sessionId,
      {
        run_status: 'cancelled',
        last_run_id: this.request.runId
      },
      {
        parentSessionId: this.request.parentSessionId,
        scopedChildDir: this.request.scopedChildDir
      }
    );
    return this.state.assistantText;
  }

  private async finishBlocked(reason: string): Promise<string> {
    this.state.blockedReason = reason;
    const text = reason;
    await this.emit(EventTypeCatalog.TextDone, text, { blocked: true });
    await this.emit(EventTypeCatalog.RunDone, text, { reason: 'blocked' });
    await this.deps.sessions.writeMetadata(
      this.request.sessionId,
      {
        run_status: 'blocked',
        last_run_id: this.request.runId
      },
      {
        parentSessionId: this.request.parentSessionId,
        scopedChildDir: this.request.scopedChildDir
      }
    );
    return text;
  }

  private async finishShortReply(reply: string): Promise<string> {
    this.state.shortReply = reply;
    this.state.assistantText = reply;
    await this.emit(EventTypeCatalog.TextDone, reply, { short_reply: true });
    await this.emit(EventTypeCatalog.RunDone, reply, { reason: 'short_reply' });
    await this.deps.sessions.writeMetadata(
      this.request.sessionId,
      {
        run_status: 'completed',
        last_run_id: this.request.runId
      },
      {
        parentSessionId: this.request.parentSessionId,
        scopedChildDir: this.request.scopedChildDir
      }
    );
    return reply;
  }

  private async finishFailed(error: Error): Promise<string> {
    this.state.failed = error;
    await this.emit(EventTypeCatalog.RunError, error.message, { error: error.message });
    await this.emit(EventTypeCatalog.RunDone, this.state.assistantText, {
      reason: 'failed',
      error: error.message
    });
    await this.deps.sessions.writeMetadata(
      this.request.sessionId,
      {
        run_status: 'failed',
        last_run_id: this.request.runId,
        last_error: error.message
      },
      {
        parentSessionId: this.request.parentSessionId,
        scopedChildDir: this.request.scopedChildDir
      }
    );
    throw error;
  }

  private bindHookDeps(): void {
    const id = this.agent.identity();
    const hookDeps = new PerRunHookDeps(
      {
        scope: id.scope,
        runtimeId: id.runtimeId || this.request.runtimeId,
        agentId: id.agentId || this.request.agentId,
        userId: id.userId || this.request.userId,
        sessionId: id.sessionId || this.request.sessionId,
        parentSessionId: id.parentSessionId || this.request.parentSessionId,
        scopedChildDir: id.scopedChildDir || this.request.scopedChildDir,
        agentRoot: id.agentRoot,
        workspaceRoot: id.workspaceRoot,
        sessionRoot: id.sessionRoot,
        sharedSkillsRoot: id.sharedSkillsRoot
      },
      withDefaultPolicy(this.request),
      async (type, content, data) => {
        await this.emit(type as typeof EventTypeCatalog.UserInput, content, (data as Record<string, unknown>) ?? {});
      }
    );
    this.store.hookDeps = hookDeps;
    this.deps.hooks.setRunDeps(hookDeps);
  }

  private async emit(
    type: (typeof EventTypeCatalog)[keyof typeof EventTypeCatalog] | string,
    content: string,
    data?: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.deps.emitter.emitEvent(type as typeof EventTypeCatalog.UserInput, content, data);
    } catch (err) {
      this.logger.warn(`[orchestrate] emit failed type=${type} err=${String(err)}`);
    }
  }
}

export const defaultOrchestrator = new DefaultOrchestrator();
