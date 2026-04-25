/**
 * Agent Executor — 执行调度层
 *
 * 所有 Agent 执行的统一入口。
 * 位于 API 层和 Runtime 层之间，职责聚焦于：
 *   1. 并发控制 — 同一 session 串行执行（busy 锁）
 *   2. 无状态生命周期 — 每次请求创建 Runtime → 执行 → 销毁
 *   3. Builder 工厂 — piMono() / openai()
 *
 * 已提取的职责：
 *   - Builder 实现 → runtime/pimono/PiMonoBuilder.ts, runtime/openai/OpenAIBuilder.ts
 *   - 环境注入 → AgentEnvInjector.ts
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

import { SessionStatusManager, type SessionStatus } from './runtime/SessionStatusManager';
import type { AgentRuntime } from './runtime/AgentRuntime';
import type { AgentRuntimeOptions, ExecutionConfig, ExecutionResult, StreamChunk } from './runtime/types';
import { AgentRuntimeBuilder } from './runtime/AgentRuntimeBuilder';
import { createStreamEmitter, type IStreamEmitter } from './streaming/StreamEmitter';
import type { StreamSource } from './streaming/types';
import { injectEnv } from './AgentEnvInjector';
import { streamConsumersManager } from './streaming/StreamConsumersManager';
import { ProviderInjector } from './provider/ProviderInjector';
import { SkillManager } from './skills/SkillManager';

// ==================== 类型定义 ====================

/** 支持的 Builder 类型 */
export type AgentBuilder = AgentRuntimeBuilder;

/** 执行请求 */
export interface ExecuteRequest {
  /** 会话 ID */
  sessionId: string;
  /** 用户消息 */
  message: string;
  /** Builder 实例（通过 agentExecutor.piMono() 或 agentExecutor.openai() 创建） */
  builder?: AgentBuilder;
  /** 预构建的 Runtime（Orchestrator / Swarm 等已初始化的运行时，跳过 Builder 流程） */
  runtime?: AgentRuntime;
  /** 流式事件回调（可选） */
  onChunk?: (chunk: StreamChunk) => void;
  /** 中止信号（Pipeline 传入，用于提前终止流式消费） */
  signal?: AbortSignal;
  /** 执行配置（传递给 Runtime.stream/run，用于指定 maxTurns / signal 等） */
  executionConfig?: ExecutionConfig;
}

/** 执行状态（从 SessionStatusManager re-export） */
export type { SessionStatus } from './runtime/SessionStatusManager';

// ==================== AgentExecutor ====================

class AgentExecutor {
  private getRuntimeIdentity(runtime: AgentRuntime): { id: string; name: string } {
    const candidate = runtime as AgentRuntime & { id?: string; name?: string };
    return {
      id: candidate.id ?? 'agent-runtime',
      name: candidate.name ?? 'agent'
    };
  }

  /** 活跃会话状态管理 */
  private sessionStatus = new SessionStatusManager();

  /** Provider 配置注入器 */
  private providerInjector = new ProviderInjector();

  /** 活跃会话的 AbortController 映射（用于按 sessionId 中止） */
  private abortControllers = new Map<string, AbortController>();

  // ========== Provider 系统 ==========

  /**
   * 注入 Provider 配置到 Builder（API Key + 模型 + baseURL）
   *
   * 供 chat.ts、Orchestrator Worker、Swarm Role 等所有创建 Agent 的地方使用。
   */
  applyProviderConfig(
    builder: AgentBuilder,
    opts?: { modelOverride?: string; sessionId?: string; agentId?: string }
  ): void {
    this.providerInjector.applyProviderConfig(builder, opts);
  }

  /**
   * 注入默认思维链级别到 Builder
   */
  applyThinkingLevel(builder: AgentBuilder): void {
    this.providerInjector.applyThinkingLevel(builder);
  }

  // ========== 消息管线 ==========

  // ========== Builder 工厂 ==========

  /**
   * 创建 PiMono Agent Builder（自动注入 Provider 配置 + 思维链级别）
   *
   * 所有通过此工厂创建的 Agent（单 Agent、Orchestrator Worker、Swarm Role 等）
   * 天然就有 API Key、model、baseURL 和 thinkingLevel。
   * 调用方只需关心自己的业务配置（instructions、tools、name 等）。
   * 如需覆盖模型，在工厂返回后调 .model() 即可。
   */
  piMono(): AgentRuntimeBuilder {
    const builder = new AgentRuntimeBuilder().type('pi-mono');
    this.applyProviderConfig(builder);
    this.applyThinkingLevel(builder);
    return builder;
  }

  /** 创建 OpenAI Agent Builder */
  openai(): AgentRuntimeBuilder {
    const builder = new AgentRuntimeBuilder().type('openai');
    this.applyProviderConfig(builder);
    return builder;
  }

  // ========== 提交执行 ==========

  /**
   * 提交执行请求（非阻塞）
   *
   * 立即返回状态，流式事件通过 StreamEmitter → EventBus → WebSocket 推送。
   * 如果 session 正在执行中，返回 busy 错误。
   */
  submit(request: ExecuteRequest): { status: 'accepted'; sessionId: string } | { status: 'busy'; sessionId: string } {
    const { sessionId } = request;

    if (this.sessionStatus.isRunning(sessionId)) {
      log.warn(`[AgentExecutor] Session busy: ${sessionId}`);
      return { status: 'busy', sessionId };
    }

    this.sessionStatus.register(sessionId);

    this.execute(request)
      .catch((error: unknown) => {
        log.error(`[AgentExecutor] Execution failed: sessionId=${sessionId}`, error);
      })
      .finally(() => {
        this.sessionStatus.unregister(sessionId);
      });

    return { status: 'accepted', sessionId };
  }

  /**
   * 提交并等待执行完成（阻塞）
   *
   * 适用于需要同步获取结果的场景（如测试）。
   */
  async submitAndWait(request: ExecuteRequest): Promise<ExecutionResult> {
    const { sessionId } = request;

    if (this.sessionStatus.isRunning(sessionId)) {
      throw new Error(`Session ${sessionId} is busy`);
    }

    this.sessionStatus.register(sessionId);
    try {
      return await this.execute(request);
    } finally {
      this.sessionStatus.unregister(sessionId);
    }
  }

  // ========== 状态查询 ==========

  /** 查询 session 状态 */
  getStatus(sessionId: string): SessionStatus {
    return this.sessionStatus.getStatus(sessionId);
  }

  /** 获取所有活跃 session */
  getActiveSessions(): Array<{ sessionId: string; startedAt: number }> {
    return this.sessionStatus.getActiveList();
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
  async *stream(request: Omit<ExecuteRequest, 'onChunk'>): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
    const { sessionId } = request;

    if (this.sessionStatus.isRunning(sessionId)) {
      throw new Error(`Session ${sessionId} is busy`);
    }

    this.sessionStatus.register(sessionId);
    try {
      const result = yield* this.executePipeline(request);
      return result;
    } finally {
      this.sessionStatus.unregister(sessionId);
      // 清理 AbortController（在流式执行完全结束后）
      this.abortControllers.delete(sessionId);
    }
  }

  // ========== 内部执行 ==========

  /**
   * 消费 AsyncGenerator 并通过统一分发器处理所有事件
   */
  private async *consumeAndForward(
    gen: AsyncGenerator<StreamChunk, ExecutionResult, unknown>,
    emitter: IStreamEmitter | null,
    sessionId: string,
    onChunk?: (chunk: StreamChunk) => void,
    signal?: AbortSignal,
    _workspaceDir?: string,
    agentId?: string
  ): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
    // Turn 状态跟踪（用于 turn_completed 事件数据）
    let turnStartTime = 0;
    let turnToolCallCount = 0;

    // 标记开始执行
    this.updateSessionStatus(sessionId, 'running');

    let r = await gen.next();
    while (!r.done) {
      // 检测中止信号：提前退出循环，通知 generator 结束
      if (signal?.aborted) {
        log.info(`[AgentExecutor] Aborted: sessionId=${sessionId}`);

        // 发送 run:interrupted 事件
        const interruptedChunk: StreamChunk = {
          type: 'run:interrupted',
          content: 'Execution cancelled by user'
        };

        if (emitter) {
          emitter.forward(interruptedChunk);
        }
        onChunk?.(interruptedChunk);
        yield interruptedChunk;

        await gen.return({ output: '', error: 'Aborted by user' } as ExecutionResult);
        this.updateSessionStatus(sessionId, 'idle');
        return { output: '', error: 'Aborted by user' };
      }

      const chunk = r.value as StreamChunk;

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

      // 使用 Promise.race 让 abort 信号能在 gen.next() 阻塞期间生效
      if (signal) {
        const abortPromise = new Promise<{ done: true; value: ExecutionResult }>((resolve) => {
          const onAbort = (): void => {
            signal.removeEventListener('abort', onAbort);
            resolve({ done: true, value: { output: '', error: 'Aborted by user' } });
          };
          if (signal.aborted) {
            resolve({ done: true, value: { output: '', error: 'Aborted by user' } });
          } else {
            signal.addEventListener('abort', onAbort, { once: true });
            // 当 gen.next() 正常完成时也需要清理监听器
            gen.next().then(
              (result) => {
                signal.removeEventListener('abort', onAbort);
                resolve(result as { done: true; value: ExecutionResult });
              },
              (err) => {
                signal.removeEventListener('abort', onAbort);
                throw err;
              }
            );
          }
        });
        r = await abortPromise;
        if (signal.aborted && !r.done) {
          log.info(`[AgentExecutor] Aborted during gen.next(): sessionId=${sessionId}`);

          // 发送 run:interrupted 事件
          const interruptedChunk: StreamChunk = {
            type: 'run:interrupted',
            content: 'Execution cancelled by user'
          };

          if (emitter) {
            emitter.forward(interruptedChunk);
          }
          onChunk?.(interruptedChunk);
          yield interruptedChunk;

          await gen.return({ output: '', error: 'Aborted by user' } as ExecutionResult);
          this.updateSessionStatus(sessionId, 'idle');
          return { output: '', error: 'Aborted by user' };
        }
      } else {
        r = await gen.next();
      }
    }

    // 执行完成
    this.updateSessionStatus(sessionId, 'completed');

    return r.value as ExecutionResult;
  }

  /**
   * 根据 StreamChunk 类型更新会话状态
   *
   * fire-and-forget：不阻塞流式输出。
   * 同步更新 Thread 的 runStatus。
   */
  private updateSessionStatus(sessionId: string, status: string): void {
    const isSubAgent = sessionId.includes(':');

    // 子 Agent 状态更新已移除（不再关注子智能体）
    if (isSubAgent) {
      return;
    }

    if (status === 'tool-pending' || status === 'running' || status === 'error' || status === 'completed') {
      this.syncThreadRunStatus(sessionId, status as 'running' | 'tool-pending' | 'error' | 'idle' | 'completed');
    }
  }

  private updateCheckpoint(sessionId: string, chunk: StreamChunk): void {
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
  private syncThreadRunStatus(sessionId: string, runStatus: import('./threads/types').ThreadRunStatus): void {
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
  private async *executePipeline(request: ExecuteRequest): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
    const { sessionId, message, builder, onChunk, signal: externalSignal } = request;
    let runtime: AgentRuntime | null = null;

    log.info(`[AgentExecutor] Execute Pipeline: sessionId=${sessionId}, message="${message.slice(0, 50)}..."`);
    const startTime = Date.now();

    // 创建或使用外部提供的 AbortController
    let internalController: AbortController | undefined;
    let signal = externalSignal;

    if (!signal) {
      internalController = new AbortController();
      signal = internalController.signal;
      this.abortControllers.set(sessionId, internalController);
    }

    let workspaceDir: string | undefined;
    let loader: import('../extension/ExtensionLoader').ExtensionLoader | null = null;

    // 检查是否轻量模式
    const isLightweight = builder ? (builder.getLightweight?.() ?? false) : false;

    if (!isLightweight) {
      const { Env } = await import('@main/common/env');
      if (builder) {
        workspaceDir = builder.getWorkspaceRoot?.();
      }
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
    }

    let emitter: IStreamEmitter | null = null;

    try {
      if (request.runtime) {
        // === 预构建 Runtime 路径（Orchestrator / Swarm / Discussion） ===
        runtime = request.runtime;

        if (!isLightweight) {
          emitter = this.createEmitter(sessionId, runtime);
        }

        // agent:start 事件
        const runtimeIdentity = this.getRuntimeIdentity(runtime);
        await this.emitAgentLifecycleEvent('agent:start', {
          sessionId,
          agentId: runtimeIdentity.id,
          agentName: runtimeIdentity.name,
          task: message.substring(0, 200)
        });

        runtime.options = this.buildRuntimeOptions(runtime, sessionId, signal, request.executionConfig);
        const gen = runtime.stream(message);
        const runtimeAgentId = builder ? builder.getAgentId?.() : undefined;

        const result = yield* this.consumeAndForward(
          gen,
          emitter,
          sessionId,
          onChunk,
          signal,
          workspaceDir,
          runtimeAgentId
        );

        const duration = Date.now() - startTime;

        // agent:done 事件
        await this.emitAgentLifecycleEvent('agent:done', {
          sessionId,
          agentId: runtimeIdentity.id,
          agentName: runtimeIdentity.name,
          success: true,
          durationMs: duration,
          summary: result.output?.substring(0, 500)
        });

        this.logCompletion(sessionId, result, duration);
        return result;
      }

      // === Builder 路径（标准 Agent / Chat） ===
      if (!builder) {
        throw new Error('ExecuteRequest requires either builder or runtime');
      }

      // 0. 注入运行时环境
      if (!isLightweight) {
        const workspace = await injectEnv(sessionId, builder);
        workspaceDir = workspace;

        // 写入用户消息到 history.jsonl
        streamConsumersManager.writeUserMessage(sessionId, message);
      }

      // === Extension Hooks: message_received + run_started + prepare_run_input ===
      if (!isLightweight) {
        await Promise.race([
          this.runExtensionHooks(sessionId, message, builder),
          new Promise<void>((resolve) => setTimeout(resolve, 60_000))
        ]).catch((err) => {
          log.warn(`[AgentExecutor] Extension start hooks timed out or failed: sessionId=${sessionId}`, err);
        });
      }

      // 1. 创建 Runtime + 创建 Emitter
      runtime = await builder.sessionId(sessionId).build();

      if (!isLightweight) {
        emitter = this.createEmitter(sessionId, runtime);
      }

      // agent:start 事件
      const runtimeIdentity = this.getRuntimeIdentity(runtime);
      await this.emitAgentLifecycleEvent('agent:start', {
        sessionId,
        agentId: runtimeIdentity.id,
        agentName: runtimeIdentity.name,
        task: message.substring(0, 200)
      });

      // 2. 流式执行
      runtime.options = this.buildRuntimeOptions(runtime, sessionId, signal, request.executionConfig);
      const gen = runtime.stream(message);
      const builderAgentId = builder.getAgentId?.();

      const result = yield* this.consumeAndForward(
        gen,
        emitter,
        sessionId,
        onChunk,
        signal,
        workspaceDir,
        builderAgentId
      );

      const duration = Date.now() - startTime;

      // === Extension Hooks: run_completed（fire-and-forget）===
      if (!isLightweight) {
        const stableAgentId = builderAgentId || runtimeIdentity.id;
        this.runExtensionEndHooks(sessionId, stableAgentId, result, duration).catch((err) => {
          log.warn(`[AgentExecutor] Extension end hooks failed: sessionId=${sessionId}`, err);
        });
      }

      // agent:done 事件
      await this.emitAgentLifecycleEvent('agent:done', {
        sessionId,
        agentId: runtimeIdentity.id,
        agentName: runtimeIdentity.name,
        success: true,
        durationMs: duration,
        summary: result.output?.substring(0, 500)
      });

      this.logCompletion(sessionId, result, duration);
      return result;
    } catch (error: unknown) {
      const duration = Date.now() - startTime;

      // agent:done 事件（失败）
      if (runtime) {
        const runtimeIdentity = this.getRuntimeIdentity(runtime);
        await this.emitAgentLifecycleEvent('agent:done', {
          sessionId,
          agentId: runtimeIdentity.id,
          agentName: runtimeIdentity.name,
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

      // 注意：AbortController 的清理已移到 stream() 的 finally 块中
      // 这样可以确保在整个流式执行期间 AbortController 保持有效
    }
  }

  /**
   * 核心执行流程：创建 → 推理 → 销毁
   */
  private async execute(request: ExecuteRequest): Promise<ExecutionResult> {
    const gen = this.executePipeline(request);
    let r = await gen.next();
    while (!r.done) {
      r = await gen.next();
    }
    return r.value as ExecutionResult;
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

  /** 创建 StreamEmitter */
  private createEmitter(sessionId: string, runtime: AgentRuntime): IStreamEmitter {
    const runtimeIdentity = this.getRuntimeIdentity(runtime);
    const source: StreamSource = {
      type: 'agent',
      id: runtimeIdentity.id,
      name: runtimeIdentity.name
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
  private logCompletion(sessionId: string, result: ExecutionResult, duration?: number): void {
    const durationStr = duration ? `, duration=${duration}ms` : '';
    if (result.error) {
      log.error(`[AgentExecutor] Failed: sessionId=${sessionId}${durationStr}, error=${result.error}`);
    } else {
      log.info(
        `[AgentExecutor] Completed: sessionId=${sessionId}${durationStr}, output=${result.output.slice(0, 100)}...`
      );
    }
  }

  private buildRuntimeOptions(
    runtime: AgentRuntime,
    sessionId: string,
    signal?: AbortSignal,
    executionConfig?: ExecutionConfig
  ): AgentRuntimeOptions {
    return {
      ...runtime.options,
      sessionId,
      ...(executionConfig?.maxTurns !== undefined ? { maxTurns: executionConfig.maxTurns } : {}),
      ...(signal ? { signal } : {})
    };
  }

  /** 根据 StreamChunk 触发 Agent 运行过程中的派生 Hook。 */
  private fireChunkHooks(
    chunk: StreamChunk,
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
  private async runExtensionHooks(sessionId: string, message: string, builder: AgentBuilder): Promise<void> {
    try {
      const { ExtensionManager } = await import('../extension');
      const runner = ExtensionManager.getHookRunner();
      if (!runner) return;

      await runner.runVoidHook('message_received', { sessionId, message });
      await runner.runVoidHook('run_started', { sessionId });

      const result = await runner.runModifyingHook('prepare_run_input', {
        sessionId,
        prompt: message
      });
      if (result) {
        if (result.prependContext) {
          builder.appendInstructions(result.prependContext);
        }
        if (result.replaceSystemPrompt) {
          builder.instructions(result.replaceSystemPrompt);
        }
      }
    } catch (err) {
      log.warn('[AgentExecutor] Extension hooks (start) failed:', err);
    }
  }

  /**
   * 执行 Extension 后置 Hook
   * run_completed
   */
  private async runExtensionEndHooks(
    sessionId: string,
    agentId: string,
    result: ExecutionResult,
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
export {
  AgentRuntimeBuilder,
  AgentRuntimeBuilder as PiMonoBuilder,
  AgentRuntimeBuilder as OpenAIBuilder
} from './runtime/AgentRuntimeBuilder';
