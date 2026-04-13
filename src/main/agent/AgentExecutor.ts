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
 *   - 事件写入 → AgentEventWriter.ts
 *   - 执行协议 → AgentEnvInjector.ts (buildExecutionProtocol)
 *   - HITL 审批 → extensions/tool-approval（通过 before_tool_call Hook）
 *   - 块处理（指标/ Hook/ suspendReason）→ runtime/ChunkProcessor.ts
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
import type { ExecutionResult, StreamChunk } from './runtime/types';
import { PiMonoBuilder } from './runtime/pimono/PiMonoBuilder';
import { OpenAIBuilder } from './runtime/openai/OpenAIBuilder';
import { createStreamEmitter, type IStreamEmitter } from './streaming/StreamEmitter';
import type { StreamSource } from './streaming/types';
import { injectEnv } from './AgentEnvInjector';
import { AgentEventWriter } from './AgentEventWriter';
import { ProviderInjector, type ProviderSystem } from './provider/ProviderInjector';
import { fireHooks, recordMetrics } from './runtime/ChunkProcessor';
import { SkillManager } from './skills/SkillManager';

// ==================== 类型定义 ====================

/** Provider 系统接口（从 ProviderInjector re-export） */
export type { ProviderSystem } from './provider/ProviderInjector';

/** 支持的 Builder 类型 */
export type AgentBuilder = PiMonoBuilder | OpenAIBuilder;

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
  /**
   * 模型源引用（用于故障转移重试）
   * 当 Agent 使用 @group-name 或 auto 时传入，失败后可切换到组内下一个模型
   */
  modelSourceRef?: string;
  /** 执行配置（传递给 Runtime.stream/run，用于指定 executionMode 等） */
  executionConfig?: import('./runtime/types').ExecutionConfig;
}

/** 执行状态（从 SessionStatusManager re-export） */
export type { SessionStatus } from './runtime/SessionStatusManager';

// ==================== AgentExecutor ====================

class AgentExecutor {
  /** 活跃会话状态管理 */
  private sessionStatus = new SessionStatusManager();

  /** Provider 配置注入器（初始化后通过 setProviderSystem 注入） */
  private providerInjector = new ProviderInjector();

  // ========== Provider 系统 ==========

  /**
   * 注入 Provider 系统（应用初始化时调用）
   */
  setProviderSystem(system: ProviderSystem): void {
    this.providerInjector.setProviderSystem(system);
  }

  /**
   * 获取 Provider 系统（chat.ts 等消费者使用）
   */
  getProviderSystem(): ProviderSystem | null {
    return this.providerInjector.getProviderSystem();
  }

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
  piMono(): PiMonoBuilder {
    const builder = new PiMonoBuilder();
    this.applyProviderConfig(builder);
    this.applyThinkingLevel(builder);
    return builder;
  }

  /** 创建 OpenAI Agent Builder */
  openai(): OpenAIBuilder {
    return new OpenAIBuilder();
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

  // ========== 流式执行（SSE 透传） ==========

  /**
   * 流式执行 — AsyncGenerator 透传
   *
   * 供 SSE 端点直接 yield* 使用。
   * 内部管理完整的 busy 锁 + 创建 → stream() → 销毁 生命周期。
   * 每个 chunk 同时通过 StreamEmitter.forward() 广播到 EventBus。
   */
  async *stream(request: Omit<ExecuteRequest, 'onChunk'>): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
    const { sessionId, message, builder, signal, modelSourceRef } = request;

    if (!builder) {
      throw new Error('stream() requires a builder. Use submit() with runtime for pre-built runtimes.');
    }

    if (this.sessionStatus.isRunning(sessionId)) {
      throw new Error(`Session ${sessionId} is busy`);
    }

    this.sessionStatus.register(sessionId);
    let runtime: AgentRuntime | null = null;

    // 检查是否轻量模式
    const isLightweight = (builder as unknown as { getLightweight?: () => boolean }).getLightweight?.() ?? false;

    log.info(
      `[AgentExecutor] Stream: sessionId=${sessionId}, messageLen=${message.length}, lightweight=${isLightweight}`
    );

    let eventWriter: AgentEventWriter | null = null;
    let workspaceDir: string | undefined;

    // ========== 非轻量模式：完整流程（工作空间 + EventBus） ==========
    if (!isLightweight) {
      const { Env } = await import('@main/common/env');
      if (builder) {
        workspaceDir = (builder as unknown as { getWorkspaceRoot?: () => string | undefined }).getWorkspaceRoot?.();
      }
      if (!workspaceDir) {
        workspaceDir = await Env.getAgentWorkspaceDir(sessionId);
      }

      // 加载任务级 Extension（如果存在）
      const { ExtensionManager } = await import('@main/common/extension');
      const loader = ExtensionManager.getLoader?.();
      if (loader) {
        await loader.loadWorkspaceExtensions(sessionId, workspaceDir).catch((err) => {
          log.warn(`[AgentExecutor] Failed to load workspace extensions for ${sessionId}:`, err);
        });
      }
    }

    try {
      // 0. 注入运行时环境（轻量模式下简化）
      if (!isLightweight) {
        const workspace = await injectEnv(sessionId, builder);
        eventWriter = new AgentEventWriter(workspace);
        eventWriter.register(sessionId);
      }

      // 模型组故障转移：获取候选模型列表
      const providerSystem = this.providerInjector.getProviderSystem();
      const candidates =
        modelSourceRef && providerSystem ? providerSystem.selector.getGroupCandidates(modelSourceRef) : null;
      const failedModels: string[] = [];
      let yieldedCount = 0;

      // 1. 创建 Runtime（带重试循环）
      let gen: AsyncGenerator<StreamChunk, ExecutionResult, unknown>;
      let r: IteratorResult<StreamChunk, ExecutionResult>;

      for (;;) {
        runtime = await builder.sessionId(sessionId).build();

        // 1.5 注册统一分发器（非轻量模式）
        if (eventWriter && !isLightweight) {
          eventWriter.setEmitter(this.createEmitter(sessionId, runtime));
        }

        gen = runtime.stream(message, { signal });
        r = await gen.next();

        // 模型组重试：仅当 run:error 为第一个 chunk 且未 yield 时重试
        if (!r.done && r.value.type === 'run:error' && yieldedCount === 0 && candidates && candidates.length > 0) {
          const piBuilder = builder as PiMonoBuilder;
          const currentModel = piBuilder.getResolvedModelRef?.();
          if (currentModel) failedModels.push(currentModel);

          const nextModel = candidates.find((m) => !failedModels.includes(m));
          if (nextModel) {
            log.warn(`[AgentExecutor] Model ${currentModel} failed, retrying with next in group: ${nextModel}`);
            await this.destroyRuntime(runtime);
            runtime = null;
            this.providerInjector.applyProviderConfig(piBuilder, { modelOverride: nextModel });
            continue;
          }
        }

        break;
      }

      // 2. 透传 stream()（同步触发 Extension Hook），传入 signal
      let turnStartTime = 0;
      let turnToolCallCount = 0;

      while (!r.done) {
        const chunk = r.value;

        // 统一分发：写文件 + 推前端（轻量模式下跳过）
        if (eventWriter && !isLightweight) {
          eventWriter.dispatch(chunk);
        }

        if (chunk.type === 'run:error') {
          log.error(`[AgentExecutor] API error: sessionId=${sessionId}, error=${chunk.content}`);
        }

        // Extension Hook 触发（轻量模式下跳过）
        if (!isLightweight) {
          const builderAgentId = (builder as unknown as { getAgentId?: () => string | undefined }).getAgentId?.();
          fireHooks(
            chunk,
            sessionId,
            { getTurnStartTime: () => turnStartTime, getTurnToolCallCount: () => turnToolCallCount },
            builderAgentId
          );
        }

        if (chunk.type === 'turn:start') {
          turnStartTime = Date.now();
          turnToolCallCount = 0;
        } else if (chunk.type === 'tool:done') {
          turnToolCallCount++;
        }

        yield chunk;
        yieldedCount++;
        r = await gen.next();
      }

      this.logCompletion(sessionId, r.value);
      return r.value;
    } catch (error: unknown) {
      log.error(`[AgentExecutor] Stream error: sessionId=${sessionId}`, error);
      throw error;
    } finally {
      // 清理（轻量模式下跳过）
      if (!isLightweight) {
        eventWriter?.unregister(sessionId);

        // 卸载任务级 Extension
        const { ExtensionManager } = await import('@main/common/extension');
        const loader = ExtensionManager.getLoader?.();
        if (loader) {
          await loader.unloadWorkspaceExtensions(sessionId).catch((err) => {
            log.warn(`[AgentExecutor] Failed to unload workspace extensions for ${sessionId}:`, err);
          });
        }
      }

      await this.destroyRuntime(runtime);
      runtime = null;
      this.sessionStatus.unregister(sessionId);
    }
  }

  // ========== 内部执行 ==========

  /**
   * 消费 AsyncGenerator 并通过统一分发器处理所有事件
   *
   * 事件通过 eventWriter.dispatch() 统一处理：
   *   - 分配唯一 seq（与 Extension 事件共享同一个计数器）
   *   - 写入 events.jsonl
   *   - 推送到前端（通过注册的 StreamEmitter）
   *
   * 同时在关键流式事件上触发 Extension Hook：
   *   - turn:start → turn_start (void)
   *   - turn:done  → turn_end (void)
   *   - compression:start → before_compaction (void)
   *   - compression:done  → after_compaction (void)
   */
  private async consumeAndForward(
    gen: AsyncGenerator<StreamChunk, ExecutionResult, unknown>,
    eventWriter: AgentEventWriter,
    sessionId: string,
    onChunk?: (chunk: StreamChunk) => void,
    signal?: AbortSignal,
    workspaceDir?: string,
    agentId?: string
  ): Promise<ExecutionResult> {
    // Turn 状态跟踪（用于 turn_end 事件数据）
    let turnStartTime = 0;
    let turnToolCallCount = 0;

    // 标记开始执行
    this.updateSessionStatus(sessionId, 'running', workspaceDir);

    let r = await gen.next();
    while (!r.done) {
      // 检测中止信号：提前退出循环，通知 generator 结束
      if (signal?.aborted) {
        log.info(`[AgentExecutor] Aborted: sessionId=${sessionId}`);
        await gen.return({ output: '', error: 'Aborted by user' } as ExecutionResult);
        this.updateSessionStatus(sessionId, 'idle', workspaceDir);
        return { output: '', error: 'Aborted by user' };
      }

      const chunk = r.value;

      // 统一分发：写文件 + 推前端（唯一入口，seq 全局唯一）
      eventWriter.dispatch(chunk);

      // === 检查点更新（fire-and-forget） ===
      this.updateCheckpoint(sessionId, chunk, workspaceDir);

      if (chunk.type === 'run:error') {
        log.error(`[AgentExecutor] API error in execute: error=${chunk.content}`);
      }

      // === Extension Hook 触发（fire-and-forget，不阻塞流） ===
      fireHooks(
        chunk,
        sessionId,
        { getTurnStartTime: () => turnStartTime, getTurnToolCallCount: () => turnToolCallCount },
        agentId
      );

      // Turn 状态更新
      if (chunk.type === 'turn:start') {
        turnStartTime = Date.now();
        turnToolCallCount = 0;
      } else if (chunk.type === 'tool:done') {
        turnToolCallCount++;
      }

      // === 指标采集（fire-and-forget，不阻塞流） ===
      recordMetrics(chunk, sessionId);

      onChunk?.(chunk);

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
          await gen.return({ output: '', error: 'Aborted by user' } as ExecutionResult);
          this.updateSessionStatus(sessionId, 'idle', workspaceDir);
          return { output: '', error: 'Aborted by user' };
        }
      } else {
        r = await gen.next();
      }
    }

    // 执行完成
    this.updateSessionStatus(sessionId, 'completed', workspaceDir);

    return r.value;
  }

  /**
   * 根据 StreamChunk 类型更新会话状态
   *
   * fire-and-forget：不阻塞流式输出。
   * 同步更新 Thread 的 runStatus。
   */
  private updateSessionStatus(sessionId: string, status: string, workspaceDir?: string): void {
    const isSubAgent = sessionId.includes(':');

    // 子 Agent 状态更新已移除（不再关注子智能体）
    if (isSubAgent) {
      return;
    }

    if (status === 'tool-pending' || status === 'running' || status === 'error' || status === 'completed') {
      this.syncThreadRunStatus(sessionId, status as 'running' | 'tool-pending' | 'error' | 'idle' | 'completed');
    }
  }

  private updateCheckpoint(sessionId: string, chunk: StreamChunk, workspaceDir?: string): void {
    switch (chunk.type) {
      case 'tool:start':
        this.updateSessionStatus(sessionId, 'tool-pending', workspaceDir);
        break;
      case 'tool:done':
        this.updateSessionStatus(sessionId, 'running', workspaceDir);
        break;
      case 'run:error':
        this.updateSessionStatus(sessionId, 'error', workspaceDir);
        break;
      case 'run:done':
        this.updateSessionStatus(sessionId, 'completed', workspaceDir);
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
   * 核心执行流程：创建 → 推理 → 销毁
   *
   * 安全策略：
   *   所有工具执行受 ExecPolicy 和 ToolPolicy 保护
   *   - ExecPolicy: 基于命令白名单/黑名单的安全检查
   *   - ToolPolicy: 基于工具名称的访问控制
   */
  private async execute(request: ExecuteRequest): Promise<ExecutionResult> {
    const { sessionId, message, builder, onChunk, signal } = request;
    let runtime: AgentRuntime | null = null;

    log.info(`[AgentExecutor] Execute: sessionId=${sessionId}, message="${message.slice(0, 50)}..."`);
    const startTime = Date.now();

    let eventWriter: AgentEventWriter | null = null;

    let workspaceDir: string | undefined;
    const { Env } = await import('@main/common/env');
    if (builder) {
      workspaceDir = (builder as unknown as { getWorkspaceRoot?: () => string | undefined }).getWorkspaceRoot?.();
    }
    if (!workspaceDir) {
      workspaceDir = await Env.getAgentWorkspaceDir(sessionId);
    }

    // 加载任务级 Extension（如果存在）
    const { ExtensionManager } = await import('@main/common/extension');
    const loader = ExtensionManager.getLoader?.();
    if (loader) {
      await loader.loadWorkspaceExtensions(sessionId, workspaceDir).catch((err) => {
        log.warn(`[AgentExecutor] Failed to load workspace extensions for ${sessionId}:`, err);
      });
    }

    try {
      if (request.runtime) {
        // === 预构建 Runtime 路径（Orchestrator / Swarm / Discussion） ===
        eventWriter = new AgentEventWriter(workspaceDir);
        eventWriter.register(sessionId);

        runtime = request.runtime;
        eventWriter.setEmitter(this.createEmitter(sessionId, runtime));

        // agent:start 事件
        await this.emitAgentLifecycleEvent('agent:start', {
          sessionId,
          agentId: runtime.id,
          agentName: runtime.name,
          task: message.substring(0, 200)
        });

        const streamConfig = { signal, ...request.executionConfig };
        const gen = runtime.stream(message, streamConfig);
        const runtimeAgentId = (builder as unknown as { getAgentId?: () => string | undefined })?.getAgentId?.();
        const result = await this.consumeAndForward(
          gen,
          eventWriter,
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
          agentId: runtime.id,
          agentName: runtime.name,
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
      const workspace = await injectEnv(sessionId, builder);
      eventWriter = new AgentEventWriter(workspace);
      eventWriter.register(sessionId);

      // 重置审批计数器（会话开始）
      const { resetApprovalCounter } = await import('./runtime/shared/ToolExecutionPipeline');
      resetApprovalCounter(sessionId);

      // === Extension Hooks: message_received + session_start + before_agent_start ===
      await Promise.race([
        this.runExtensionHooks(sessionId, message, builder),
        new Promise<void>((resolve) => setTimeout(resolve, 60_000))
      ]).catch((err) => {
        log.warn(`[AgentExecutor] Extension start hooks timed out or failed: sessionId=${sessionId}`, err);
      });

      // 1. 创建 Runtime + 注册统一分发器
      runtime = await builder.sessionId(sessionId).build();
      eventWriter.setEmitter(this.createEmitter(sessionId, runtime));

      // agent:start 事件
      await this.emitAgentLifecycleEvent('agent:start', {
        sessionId,
        agentId: runtime.id,
        agentName: runtime.name,
        task: message.substring(0, 200)
      });

      // 2. 流式执行（HITL 在 before_tool_call Hook 中自动处理），传入 signal
      const gen = runtime.stream(message, { signal });
      const builderAgentId2 = (builder as unknown as { getAgentId?: () => string | undefined }).getAgentId?.();
      const result = await this.consumeAndForward(
        gen,
        eventWriter,
        sessionId,
        onChunk,
        signal,
        workspaceDir,
        builderAgentId2
      );

      const duration = Date.now() - startTime;

      // === Extension Hooks: agent_end + session_end（fire-and-forget）===
      // void 钩子不产生主流程需要的结果，异步执行不阻塞会话释放
      const stableAgentId = builderAgentId2 || runtime.id;
      this.runExtensionEndHooks(sessionId, stableAgentId, result, duration).catch((err) => {
        log.warn(`[AgentExecutor] Extension end hooks failed: sessionId=${sessionId}`, err);
      });

      // agent:done 事件
      await this.emitAgentLifecycleEvent('agent:done', {
        sessionId,
        agentId: runtime.id,
        agentName: runtime.name,
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
        await this.emitAgentLifecycleEvent('agent:done', {
          sessionId,
          agentId: runtime.id,
          agentName: runtime.name,
          success: false,
          durationMs: duration,
          error: error instanceof Error ? error.message : String(error)
        });
      }

      log.error(`[AgentExecutor] Error: sessionId=${sessionId}, duration=${duration}ms`, error);
      throw error;
    } finally {
      eventWriter?.unregister(sessionId);
      SkillManager.clearSession(sessionId);
      await this.destroyRuntime(runtime);
      runtime = null;

      // 卸载任务级 Extension (loader 来自 execute() 开始时的导入)
      if (loader) {
        await loader.unloadWorkspaceExtensions(sessionId).catch((err) => {
          log.warn(`[AgentExecutor] Failed to unload workspace extensions for ${sessionId}:`, err);
        });
      }
    }
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
    const source: StreamSource = {
      type: runtime.type,
      id: runtime.id,
      name: runtime.name
    };
    return createStreamEmitter(sessionId, source);
  }

  /** 安全销毁 Runtime */
  private async destroyRuntime(runtime: AgentRuntime | null): Promise<void> {
    if (!runtime) return;
    try {
      await runtime.destroy();
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

  // ========== Extension Hook ==========

  /**
   * 执行 Extension 前置 Hook
   * message_received → session_start → before_agent_start
   */
  private async runExtensionHooks(sessionId: string, message: string, builder: AgentBuilder): Promise<void> {
    try {
      const { ExtensionManager } = await import('../common/extension');
      const runner = ExtensionManager.getHookRunner();
      if (!runner) return;

      await runner.runVoidHook('message_received', { sessionId, message });
      await runner.runVoidHook('session_start', { sessionId });

      const result = await runner.runModifyingHook('before_agent_start', {
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
   * agent_end → session_end
   */
  private async runExtensionEndHooks(
    sessionId: string,
    agentId: string,
    result: ExecutionResult,
    durationMs: number
  ): Promise<void> {
    try {
      const { ExtensionManager } = await import('../common/extension');
      const runner = ExtensionManager.getHookRunner();
      if (!runner) return;

      await runner.runVoidHook('agent_end', {
        sessionId,
        agentId,
        success: !result.error,
        output: result.output,
        durationMs
      });
      await runner.runVoidHook('session_end', { sessionId });

      // 清理审批计数器（会话结束）
      const { resetApprovalCounter } = await import('./runtime/shared/ToolExecutionPipeline');
      resetApprovalCounter(sessionId);
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
export { PiMonoBuilder } from './runtime/pimono/PiMonoBuilder';
export { OpenAIBuilder } from './runtime/openai/OpenAIBuilder';
