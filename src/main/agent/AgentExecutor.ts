/**
 * Agent Executor — 执行调度层
 *
 * 所有 Agent 执行的统一入口。
 * 位于 API 层和 Runtime 层之间，职责聚焦于：
 *   1. 并发控制 — 同一 session 串行执行（busy 锁）
 *   2. 无状态生命周期 — 每次请求创建 Runtime → 执行 → 销毁
 *   3. Runtime 构建 — 在执行管道末端统一创建 Builder 并 build()
 *
 * 已提取的职责：
 *   - Builder 实现 → runtime/AgentRuntimeBuilder.ts
 *   - 环境准备 → AgentEnvInjector.ts
 *   - 事件广播 / 持久化 → StreamEmitter.ts + StreamConsumersManager.ts
 *   - 执行协议 → AgentEnvInjector.ts (buildExecutionProtocol)
 *   - HITL 审批 → extensions/tool-approval（通过 prepare_tool_call Hook）
 *   - 工具调用 Hook → runtime/shared/ToolExecutionPipeline.ts
 *
 * 设计哲学（参考 OpenClaw pi-integration-architecture）：
 *   - 消息驱动：每条用户消息触发完整的 "创建 → 推理 → 销毁" 流程
 *   - 无状态实例：Runtime 对象用完即丢，由 GC 回收
 *   - 有状态存储：会话连续性靠 JSONL 文件持久化（SDK 自动管理）
 */

import { createLogger } from '@main/common/logger';

const log = createLogger('ai');

import type { AgentRuntime } from './runtime/AgentRuntime';
import type { AgentMode, AgentRuntimeKind, AgentExecutionResult, AgentStreamChunk } from './runtime/types';
import type { ThreadRunStatus } from './threads/types';
import { AgentRuntimeBuilder } from './runtime/AgentRuntimeBuilder';
import { createStreamEmitter, type IStreamEmitter } from './streaming/StreamEmitter';
import type { StreamSource } from './streaming/types';
import { prepareAgentEnv, type PreparedAgentEnv } from './AgentEnvInjector';
import { streamConsumersManager } from './streaming/StreamConsumersManager';
import { ProviderInjector } from './provider/ProviderInjector';
import { SkillManager } from './skills/SkillManager';

// ==================== 类型定义 ====================

/** 执行请求 */
export interface AgentExecuteRequest {
  /** 会话 ID */
  sessionId: string;
  /** 用户消息 */
  message: string;
  /** Runtime 实现类型（必填） */
  runtimeType: AgentRuntimeKind;
  /** 运行模式（默认 agent） */
  mode?: AgentMode;
  /** 会话持久化方式（默认 file） */
  sessionMode?: 'memory' | 'file';
  /** 轻量模式：跳过环境准备、Extension Hook 和事件广播 */
  lightweight?: boolean;
  /** Agent 定义 ID */
  agentId?: string;
  /** 基础系统提示词 */
  instructions?: string;
  /** 模型覆盖（provider/model 或 model id） */
  modelOverride?: string;
  /** 手动指定工作区 */
  workspaceRoot?: string;
  /** 最大执行轮次 */
  maxTurns?: number;
}


interface RunInputPatch {
  instructions?: string;
  appendInstructions?: string[];
}

interface AgentRunIdentity {
  id: string;
  name: string;
}

type RuntimeNextResult =
  | (IteratorYieldResult<AgentStreamChunk> & { aborted?: false })
  | (IteratorReturnResult<AgentExecutionResult> & { aborted?: false })
  | { done: false; aborted: true };

// ==================== AgentExecutor ====================

class AgentExecutor {
  /** 活跃会话状态管理 */
  private activeSessions = new Map<string, { startedAt: number }>();

  /** Provider 配置注入器 */
  private providerInjector = new ProviderInjector();

  /** 活跃会话的 AbortController 映射（用于按 sessionId 中止） */
  private abortControllers = new Map<string, AbortController>();

  // ========== 提交执行 ==========

  /**
   * 提交执行请求（非阻塞）
   *
   * 立即返回状态，流式事件通过 StreamEmitter → EventBus → WebSocket 推送。
   * 如果 session 正在执行中，返回 busy 错误。
   */
  submit(request: AgentExecuteRequest): { status: 'accepted'; sessionId: string } | { status: 'busy'; sessionId: string } {
    const { sessionId } = request;

    if (this.activeSessions.has(sessionId)) {
      log.warn(`[AgentExecutor] Session busy: ${sessionId}`);
      return { status: 'busy', sessionId };
    }

    this.activeSessions.set(sessionId, { startedAt: Date.now() });

    this.execute(request)
      .catch((error: unknown) => {
        log.error(`[AgentExecutor] Execution failed: sessionId=${sessionId}`, error);
      })
      .finally(() => {
        this.activeSessions.delete(sessionId);
      });

    return { status: 'accepted', sessionId };
  }

  /**
   * 提交并等待执行完成（阻塞）
   *
   * 适用于需要同步获取结果的场景（如测试）。
   */
  async submitAndWait(request: AgentExecuteRequest): Promise<AgentExecutionResult> {
    const { sessionId } = request;

    if (this.activeSessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} is busy`);
    }

    this.activeSessions.set(sessionId, { startedAt: Date.now() });
    try {
      return await this.execute(request);
    } finally {
      this.activeSessions.delete(sessionId);
    }
  }

  // ========== 状态查询 ==========

  /** 查询 session 状态 */
  getStatus(sessionId: string): { busy: boolean; startedAt?: number } {
    const info = this.activeSessions.get(sessionId)
    return info ? { busy: true, startedAt: info.startedAt } : { busy: false };
  }

  /** 获取所有活跃 session */
  getActiveSessions(): Array<{ sessionId: string; startedAt: number }> {
    return Array.from(this.activeSessions.entries()).map(([sessionId, info]) => ({
      sessionId,
      startedAt: info.startedAt
    }));
  }

  /**
   * 中止指定 session 的执行
   *
   * @param sessionId - 会话 ID
   * @returns 是否成功中止（false 表示 session 不存在或未在执行）
   */
  abort(sessionId: string): boolean {
    const controller = this.abortControllers.get(sessionId);
    if (controller) {
      log.info(`[AgentExecutor] Aborting session: ${sessionId}`);
      controller.abort();
      return true;
    }

    log.warn(`[AgentExecutor] Cannot abort session: ${sessionId} (not found or not running)`);
    return false;
  }

  // ========== 流式执行（SSE 透传） ==========

  /**
   * 流式执行 — AsyncGenerator 透传
   *
   * 供 SSE 端点直接 yield* 使用。
   * 内部管理完整的 busy 锁 + 创建 → stream() → 销毁 生命周期。
   * 每个 chunk 同时通过 StreamEmitter.forward() 广播到 EventBus。
   */
  async *stream(request: AgentExecuteRequest): AsyncGenerator<AgentStreamChunk, AgentExecutionResult, unknown> {
    const { sessionId } = request;

    if (this.activeSessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} is busy`);
    }

    this.activeSessions.set(sessionId, { startedAt: Date.now() });
    try {
      const result = yield* this.executePipeline(request);
      return result;
    } finally {
      this.activeSessions.delete(sessionId);
    }
  }

  // ========== 内部执行 ==========

  /**
   * 消费 AsyncGenerator 并通过统一分发器处理所有事件
   */
  private async *consumeAndForward(
    gen: AsyncGenerator<AgentStreamChunk, AgentExecutionResult, unknown>,
    emitter: IStreamEmitter | null,
    sessionId: string,
    onChunk?: (chunk: AgentStreamChunk) => void,
    signal?: AbortSignal,
    agentId?: string
  ): AsyncGenerator<AgentStreamChunk, AgentExecutionResult, unknown> {
    // Turn 状态跟踪（用于 turn_completed 事件数据）
    let turnStartTime = 0;
    let turnToolCallCount = 0;

    // 标记开始执行
    this.updateSessionStatus(sessionId, 'running');

    let next = await this.nextWithAbort(gen, signal);
    while (!next.done) {
      if (next.aborted) {
        const interruptedChunk = await this.interruptStream(gen, emitter, sessionId, onChunk);
        yield interruptedChunk;
        return { output: '', error: 'Aborted by user' };
      }

      const chunk = next.value as AgentStreamChunk;

      // 统一分发：广播到 eventBus（监听器自动处理持久化）
      if (emitter) {
        emitter.forward(chunk);
      }

      // === 检查点更新（fire-and-forget） ===
      this.updateCheckpoint(sessionId, chunk);

      if (chunk.type === 'run:error') {
        log.error(`[AgentExecutor] API error in execute: error=${chunk.content}`);
      }

      // === Extension Hook 触发（fire-and-forget，不阻塞流） ===
      if (emitter) {
        // 仅在非轻量模式下触发 Hook
        this.fireChunkHooks(
          chunk,
          sessionId,
          { getTurnStartTime: () => turnStartTime, getTurnToolCallCount: () => turnToolCallCount },
          agentId
        );
      }

      // Turn 状态更新
      if (chunk.type === 'turn:start') {
        turnStartTime = Date.now();
        turnToolCallCount = 0;
      } else if (chunk.type === 'tool:done') {
        turnToolCallCount++;
      }

      onChunk?.(chunk);
      yield chunk;

      next = await this.nextWithAbort(gen, signal);
    }

    const result = next.value as AgentExecutionResult;
    this.updateSessionStatus(sessionId, result.error ? 'error' : 'completed');
    return result;
  }

  private async nextWithAbort(
    gen: AsyncGenerator<AgentStreamChunk, AgentExecutionResult, unknown>,
    signal?: AbortSignal
  ): Promise<RuntimeNextResult> {
    if (!signal) {
      return (await gen.next()) as RuntimeNextResult;
    }
    if (signal.aborted) {
      return { done: false, aborted: true };
    }

    return new Promise<RuntimeNextResult>((resolve, reject) => {
      const onAbort = (): void => {
        signal.removeEventListener('abort', onAbort);
        resolve({ done: false, aborted: true });
      };

      signal.addEventListener('abort', onAbort, { once: true });
      gen.next().then(
        (result) => {
          signal.removeEventListener('abort', onAbort);
          resolve(result as RuntimeNextResult);
        },
        (err) => {
          signal.removeEventListener('abort', onAbort);
          reject(err);
        }
      );
    });
  }

  private async interruptStream(
    gen: AsyncGenerator<AgentStreamChunk, AgentExecutionResult, unknown>,
    emitter: IStreamEmitter | null,
    sessionId: string,
    onChunk?: (chunk: AgentStreamChunk) => void
  ): Promise<AgentStreamChunk> {
    log.info(`[AgentExecutor] Aborted: sessionId=${sessionId}`);

    const interruptedChunk: AgentStreamChunk = {
      type: 'run:interrupted',
      content: 'Execution cancelled by user'
    };

    if (emitter) {
      emitter.forward(interruptedChunk);
    }
    onChunk?.(interruptedChunk);
    this.updateSessionStatus(sessionId, 'idle');

    try {
      await gen.return({ output: '', error: 'Aborted by user' } as AgentExecutionResult);
    } catch (err) {
      log.warn(`[AgentExecutor] Runtime did not close cleanly after abort: sessionId=${sessionId}`, err);
    }

    return interruptedChunk;
  }

  /**
   * 根据 AgentStreamChunk 类型更新会话状态
   *
   * fire-and-forget：不阻塞流式输出。
   * 同步更新 Thread 的 runStatus。
   */
  private updateSessionStatus(sessionId: string, status: ThreadRunStatus): void {
    const isSubAgent = sessionId.includes(':');

    // 子 Agent 状态更新已移除（不再关注子智能体）
    if (isSubAgent) {
      return;
    }

    this.syncThreadRunStatus(sessionId, status);
  }

  private updateCheckpoint(sessionId: string, chunk: AgentStreamChunk): void {
    switch (chunk.type) {
      case 'tool:start':
        this.updateSessionStatus(sessionId, 'tool-pending');
        break;
      case 'tool:done':
        this.updateSessionStatus(sessionId, 'running');
        break;
      case 'run:error':
        this.updateSessionStatus(sessionId, 'error');
        break;
      case 'run:done':
        this.updateSessionStatus(sessionId, 'completed');
        break;
    }
  }

  /**
   * 同步 Thread 的 runStatus（fire-and-forget）
   *
   * 仅在 sessionId 对应已有 Thread 时更新（子 Agent sessionId 含 ':' 不会匹配 Thread）。
   */
  private syncThreadRunStatus(sessionId: string, runStatus: ThreadRunStatus): void {
    if (sessionId.includes(':')) return;
    import('./threads/ThreadStore')
      .then(({ ThreadStore }) => ThreadStore.getInstance())
      .then((store) => store.update(sessionId, { runStatus }))
      .catch(() => {});
  }

  /**
   * 核心执行管道：创建 → 推理 → 销毁
   *
   * 统一处理所有的 Hooks、环境注入、事件分发和生命周期。
   */
  private async *executePipeline(request: AgentExecuteRequest): AsyncGenerator<AgentStreamChunk, AgentExecutionResult, unknown> {
    const { sessionId, message } = request;

    let runtime: AgentRuntime | null = null;

    log.info(`[AgentExecutor] Execute Pipeline: sessionId=${sessionId}, message="${message.slice(0, 50)}..."`);
    const startTime = Date.now();

    // 创建或使用外部提供的 AbortController
    let signal: AbortSignal | undefined;

    if (!signal) {
      const controller = new AbortController();
      signal = controller.signal;
      this.abortControllers.set(sessionId, controller);
    }

    let workspaceDir: string | undefined;
    let loader: import('../extension/ExtensionLoader').ExtensionLoader | null = null;
    let preparedEnv: PreparedAgentEnv | undefined;
    const mode = request.mode ?? 'agent';
    const isLightweight = request.lightweight ?? false;
    const agentName = request.agentId ?? 'agent';

    let emitter: IStreamEmitter | null = null;

    try {
      if (!isLightweight) {
        const { Env } = await import('@main/common/env');
        workspaceDir = request.workspaceRoot;
        if (!workspaceDir) {
          workspaceDir = await Env.getAgentWorkspaceDir(sessionId);
        }

        // 加载任务级 Extension（如果存在）
        const { ExtensionManager } = await import('@main/extension');
        loader = ExtensionManager.getLoader?.() || null;
        if (loader) {
          await loader.loadWorkspaceExtensions(sessionId, workspaceDir).catch((err: unknown) => {
            log.warn(`[AgentExecutor] Failed to load workspace extensions for ${sessionId}:`, err);
          });
        }

        preparedEnv = await prepareAgentEnv({
          sessionId,
          mode,
          workspaceRoot: workspaceDir,
          agentId: request.agentId,
          agentName,
          hasRequestTools: false
        });
        workspaceDir = preparedEnv?.workspace ?? workspaceDir;

        // 写入用户消息到 history.jsonl
        streamConsumersManager.writeUserMessage(sessionId, message);
      }

      // === Extension Hooks: message_received + run_started + prepare_run_input ===
      let runInputPatch: RunInputPatch | undefined;
      if (!isLightweight) {
        runInputPatch = await Promise.race([
          this.runExtensionHooks(sessionId, message),
          new Promise<RunInputPatch | undefined>((_, reject) => {
            setTimeout(() => reject(new Error('Extension start hooks timed out')), 60_000);
          })
        ]).catch((err) => {
          log.warn(`[AgentExecutor] Extension start hooks timed out or failed: sessionId=${sessionId}`, err);
          return undefined;
        });
      }

      const builder = this.createBuilder(request, preparedEnv, signal, runInputPatch);

      // 1. 创建 Runtime + 创建 Emitter
      runtime = await builder.build();
      const runIdentity = this.getRunIdentity(request, runtime);

      if (!isLightweight) {
        emitter = this.createEmitter(sessionId, runIdentity);
      }

      // agent:start 事件
      await this.emitAgentLifecycleEvent('agent:start', {
        sessionId,
        agentId: runIdentity.id,
        agentName: runIdentity.name,
        task: message.substring(0, 200)
      });

      // 2. 流式执行
      const gen = runtime.stream(message);
      const requestAgentId = request.agentId;

      const result = yield* this.consumeAndForward(gen, emitter, sessionId, undefined, signal, requestAgentId);

      const duration = Date.now() - startTime;

      // === Extension Hooks: run_completed（fire-and-forget）===
      if (!isLightweight) {
        const stableAgentId = requestAgentId || runIdentity.id;
        this.runExtensionEndHooks(sessionId, stableAgentId, result, duration).catch((err) => {
          log.warn(`[AgentExecutor] Extension end hooks failed: sessionId=${sessionId}`, err);
        });
      }

      // agent:done 事件
      await this.emitAgentLifecycleEvent('agent:done', {
        sessionId,
        agentId: runIdentity.id,
        agentName: runIdentity.name,
        success: true,
        durationMs: duration,
        summary: result.output?.substring(0, 500)
      });

      this.logCompletion(sessionId, result, duration);
      return result;
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      this.updateSessionStatus(sessionId, 'error');

      // agent:done 事件（失败）
      if (runtime) {
        const runIdentity = this.getRunIdentity(request, runtime);
        await this.emitAgentLifecycleEvent('agent:done', {
          sessionId,
          agentId: runIdentity.id,
          agentName: runIdentity.name,
          success: false,
          durationMs: duration,
          error: error instanceof Error ? error.message : String(error)
        });
      }

      log.error(`[AgentExecutor] Error: sessionId=${sessionId}, duration=${duration}ms`, error);
      throw error;
    } finally {
      if (!isLightweight) {
        SkillManager.clearSession(sessionId);

        // 清理监听器缓存
        await streamConsumersManager.clearSession(sessionId);

        // 卸载任务级 Extension
        if (loader) {
          await loader.unloadWorkspaceExtensions(sessionId).catch((err: unknown) => {
            log.warn(`[AgentExecutor] Failed to unload workspace extensions for ${sessionId}:`, err);
          });
        }
      }

      await this.destroyRuntime(runtime);
      runtime = null;
      this.abortControllers.delete(sessionId);
    }
  }

  /**
   * 核心执行流程：创建 → 推理 → 销毁
   */
  private async execute(request: AgentExecuteRequest): Promise<AgentExecutionResult> {
    const gen = this.executePipeline(request);
    let r = await gen.next();
    while (!r.done) {
      r = await gen.next();
    }
    return r.value as AgentExecutionResult;
  }

  // ========== 辅助方法 ==========

  /** 发射 Agent 生命周期事件到 EventBus（静默失败，不影响主流程） */
  private async emitAgentLifecycleEvent(event: string, payload: Record<string, unknown>): Promise<void> {
    try {
      const { eventBus } = await import('@main/common/eventbus');
      eventBus.emit(event, { ...payload, timestamp: Date.now() });
    } catch {
      // EventBus 不可用时静默
    }
  }

  private getRunIdentity(request: AgentExecuteRequest, runtime: AgentRuntime): AgentRunIdentity {
    const name = request.agentId ?? runtime.options.name ?? 'agent';
    return {
      id: request.agentId ?? name,
      name
    };
  }

  /** 创建 StreamEmitter */
  private createEmitter(sessionId: string, identity: AgentRunIdentity): IStreamEmitter {
    const source: StreamSource = {
      type: 'agent',
      id: identity.id,
      name: identity.name
    };
    return createStreamEmitter(sessionId, source);
  }

  /** 安全销毁 Runtime */
  private async destroyRuntime(runtime: AgentRuntime | null): Promise<void> {
    if (!runtime) return;
    try {
      const destroyable = runtime as AgentRuntime & { destroy?: () => Promise<void> };
      if (typeof destroyable.destroy === 'function') {
        await destroyable.destroy();
      }
    } catch (e: unknown) {
      log.warn('[AgentExecutor] Runtime destroy warning:', e);
    }
  }

  /** 记录完成日志 */
  private logCompletion(sessionId: string, result: AgentExecutionResult, duration?: number): void {
    const durationStr = duration ? `, duration=${duration}ms` : '';
    if (result.error) {
      log.error(`[AgentExecutor] Failed: sessionId=${sessionId}${durationStr}, error=${result.error}`);
    } else {
      log.info(
        `[AgentExecutor] Completed: sessionId=${sessionId}${durationStr}, output=${result.output.slice(0, 100)}...`
      );
    }
  }

  /**
   * 根据 AgentExecuteRequest 和环境准备结果创建 Builder。
   *
   * Builder 只在这里创建一次，随后在 executePipeline 里 build() 一次。
   */
  private createBuilder(
    request: AgentExecuteRequest,
    preparedEnv?: PreparedAgentEnv,
    signal?: AbortSignal,
    runInputPatch?: RunInputPatch
  ): AgentRuntimeBuilder {
    const mode = request.mode ?? 'agent';
    const runtimeType = this.resolveRuntimeType(request);
    const sessionMode = request.sessionMode ?? 'file';
    const name = request.agentId ?? 'agent';
    const instructions = runInputPatch?.instructions ?? request.instructions ?? '';

    const builder = new AgentRuntimeBuilder()
      .type(runtimeType)
      .mode(mode)
      .lightweight(request.lightweight ?? false)
      .sessionId(request.sessionId)
      .sessionMode(sessionMode)
      .name(name)
      .instructions(instructions);

    if (request.agentId) {
      builder.agentId(request.agentId);
    }

    this.providerInjector.apply(builder, request.modelOverride);

    if (request.workspaceRoot) {
      builder.workspaceRoot(request.workspaceRoot);
    }
    if (request.maxTurns !== undefined) {
      builder.maxTurns(request.maxTurns);
    }
    if (signal) {
      builder.signal(signal);
    }

    if (preparedEnv) {
      builder.sessionDir(preparedEnv.sessionDir);
      builder.workspaceRoot(preparedEnv.workspaceRoot);
      builder.contextDir(preparedEnv.contextDir);

      if (preparedEnv.appendInstructions.length > 0) {
        builder.appendInstructions(...preparedEnv.appendInstructions);
      }
      if (preparedEnv.skills.length > 0) {
        builder.skills(preparedEnv.skills);
      }
      if (preparedEnv.tools && preparedEnv.tools.length > 0) {
        builder.tools(preparedEnv.tools);
      }
      if (preparedEnv.sandboxContext) {
        builder.sandboxContext(preparedEnv.sandboxContext);
      }
    }

    if (runInputPatch?.appendInstructions?.length) {
      builder.appendInstructions(...runInputPatch.appendInstructions);
    }

    return builder;
  }

  private resolveRuntimeType(request: AgentExecuteRequest): AgentRuntimeKind {
    return request.runtimeType;
  }
  /** 根据 AgentStreamChunk 触发 Agent 运行过程中的派生 Hook。 */
  private fireChunkHooks(
    chunk: AgentStreamChunk,
    sessionId: string,
    turnState: { getTurnStartTime: () => number; getTurnToolCallCount: () => number },
    agentId?: string
  ): void {
    if (
      chunk.type !== 'turn:start' &&
      chunk.type !== 'turn:done' &&
      chunk.type !== 'compression:start' &&
      chunk.type !== 'compression:done'
    ) {
      return;
    }

    const fire = async (): Promise<void> => {
      const { ExtensionManager } = await import('@main/extension');
      const runner = ExtensionManager.getHookRunner();
      if (!runner) return;

      const data = chunk.data as Record<string, unknown> | undefined;

      switch (chunk.type) {
        case 'turn:start':
          await runner.runVoidHook('turn_started', {
            sessionId,
            turnIndex: (data?.turnIndex as number) || 1
          });
          break;

        case 'turn:done':
          await runner.runVoidHook('turn_completed', {
            sessionId,
            turnIndex: (data?.turnIndex as number) || 1,
            durationMs: Date.now() - turnState.getTurnStartTime(),
            toolCallCount: turnState.getTurnToolCallCount()
          });
          break;

        case 'compression:start':
          await runner.runVoidHook('compaction_started', {
            sessionId,
            agentId: agentId || (data?.agentId as string | undefined),
            messageCount: 0,
            totalTokens: (data?.totalTokens as number) || 0,
            threshold: (data?.threshold as number) || 0
          });
          break;

        case 'compression:done':
          await runner.runVoidHook('compaction_completed', {
            sessionId,
            originalTokens: (data?.originalTokens as number) || 0,
            compressedTokens: (data?.summaryTokens as number) || 0,
            compressionRatio: (data?.compressionRatio as number) || 0,
            durationMs: (data?.duration as number) || 0
          });
          break;
      }
    };

    fire().catch((err) => {
      log.warn(`[AgentExecutor] Chunk-derived hook failed for ${chunk.type}:`, err);
    });
  }

  // ========== Extension Hook ==========

  /**
   * 执行 Extension 前置 Hook
   * message_received → run_started → prepare_run_input
   */
  private async runExtensionHooks(sessionId: string, message: string): Promise<RunInputPatch | undefined> {
    try {
      const { ExtensionManager } = await import('../extension');
      const runner = ExtensionManager.getHookRunner();
      if (!runner) return undefined;

      await runner.runVoidHook('message_received', { sessionId, message });
      await runner.runVoidHook('run_started', { sessionId });

      const result = await runner.runModifyingHook('prepare_run_input', {
        sessionId,
        prompt: message
      });
      if (!result) {
        return undefined;
      }

      const patch: RunInputPatch = {};
      if (result.replaceSystemPrompt) {
        patch.instructions = result.replaceSystemPrompt;
      }
      if (result.prependContext) {
        patch.appendInstructions = [result.prependContext];
      }
      return patch.instructions || patch.appendInstructions?.length ? patch : undefined;
    } catch (err) {
      log.warn('[AgentExecutor] Extension hooks (start) failed:', err);
      return undefined;
    }
  }

  /**
   * 执行 Extension 后置 Hook
   * run_completed
   */
  private async runExtensionEndHooks(
    sessionId: string,
    agentId: string,
    result: AgentExecutionResult,

    durationMs: number
  ): Promise<void> {
    try {
      const { ExtensionManager } = await import('../extension');
      const runner = ExtensionManager.getHookRunner();
      if (!runner) return;

      await runner.runVoidHook('run_completed', {
        sessionId,
        agentId,
        success: !result.error,
        output: result.output,
        durationMs
      });
    } catch (err) {
      log.warn('[AgentExecutor] Extension hooks (end) failed:', err);
    }
  }
}

// ==================== 单例导出 ====================

export const agentExecutor = new AgentExecutor();

/**
 * 获取 AgentExecutor 单例（便于延迟依赖注入）
 */
export function getAgentExecutor(): AgentExecutor {
  return agentExecutor;
}

// Re-export builders for consumers
export { AgentRuntimeBuilder } from './runtime/AgentRuntimeBuilder';
