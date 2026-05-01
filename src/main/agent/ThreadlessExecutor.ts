import { agentExecutor } from './AgentExecutor';
import type { AgentExecuteRequest } from './AgentExecutor';
import type { AgentMode, AgentRuntimeKind, AgentStreamChunk, AgentExecutionResult } from './runtime/types';
import { normalizeModelSpec } from './provider/ModelSpec';
import { generateSnowflakeId } from '../utils/SnowflakeIdGenerator';

export interface ThreadlessExecutionOptions {
  runtimeType?: AgentRuntimeKind;
  mode?: AgentMode;
  lightweight?: boolean;
  maxTurns?: number;
  sessionId?: string;
  /** 显式项目目录；不传时按本次一次性 sessionId 创建标准 project。 */
  workspaceRoot?: string;
  /**
   * 本次请求的附加系统约束，会被追加到 Agent 默认 instructions 之后。
   * 用于“一句话润色”等 preset 场景，不修改 Agent 配置本身。
   */
  instructions?: string;
  /**
   * 覆盖 Agent 默认模型（provider/model）。
   */
  modelOverride?: string;
}

export interface ThreadlessMessageParams extends ThreadlessExecutionOptions {
  agentId: string;
  message: string;
}

/**
 * 无 Thread 场景的对外执行门面。
 *
 * 外部调用方只需要提供 agentId 和 message；Agent、模型、指令和一次性 session
 * 的装配由本类完成，真正执行仍委托给底层 AgentExecutor。
 *
 * 用法：
 *   import { ThreadlessExecutor } from '@main/agent/ThreadlessExecutor';
 *   const output = await ThreadlessExecutor.run(agentId, message);
 */
export class ThreadlessExecutor {
  private constructor() {
    // 工具类，不允许实例化
  }

  static async *stream(
    agentId: string,
    message: string,
    options: ThreadlessExecutionOptions = {}
  ): AsyncGenerator<AgentStreamChunk, AgentExecutionResult, unknown> {
    const request = await ThreadlessExecutor.createRequest({ agentId, message, ...options });
    return yield* agentExecutor.stream(request);
  }

  static async run(agentId: string, message: string, options: ThreadlessExecutionOptions = {}): Promise<string> {
    let output = '';
    const gen = ThreadlessExecutor.stream(agentId, message, options);
    for await (const chunk of gen) {
      if (chunk.type === 'text:delta' && chunk.content) {
        output += chunk.content;
      }
    }
    return output;
  }

  static async *streamMessage(
    params: ThreadlessMessageParams
  ): AsyncGenerator<AgentStreamChunk, AgentExecutionResult, unknown> {
    const { agentId, message, ...options } = params;
    return yield* ThreadlessExecutor.stream(agentId, message, options);
  }

  static runMessage(params: ThreadlessMessageParams): Promise<string> {
    const { agentId, message, ...options } = params;
    return ThreadlessExecutor.run(agentId, message, options);
  }

  private static async createRequest(params: ThreadlessMessageParams): Promise<AgentExecuteRequest> {
    const { AgentStore } = await import('./agents/AgentStore');
    const store = await AgentStore.getInstance();
    const agentDef = await store.get(params.agentId);
    if (!agentDef) {
      throw new Error(`Agent "${params.agentId}" not found`);
    }

    // 合成最终 instructions：保留 agent 自身，本次 instructions 追加为一次性约束。
    const extraInstructions = params.instructions?.trim();
    const baseInstructions = agentDef.instructions ?? '';
    const mergedInstructions = extraInstructions
      ? baseInstructions
        ? `${baseInstructions}\n\n${extraInstructions}`
        : extraInstructions
      : baseInstructions;

    const modelOverride = normalizeModelSpec(params.modelOverride) || normalizeModelSpec(agentDef.model);

    const sessionId = params.sessionId ?? `threadless-agent-${params.agentId}-${generateSnowflakeId()}`;
    const { ensureAgentRuntimeLayout } = await import('./context/AgentRuntimeLayout');
    const layout = await ensureAgentRuntimeLayout({ agentId: agentDef.id, sessionId });
    const workspaceRoot = params.workspaceRoot ?? layout.projectDir;

    return {
      sessionId,
      message: params.message,
      agentId: agentDef.id,
      lightweight: params.lightweight ?? true,
      mode: params.mode ?? 'chat',
      runtimeType: params.runtimeType ?? 'pi-mono',
      sessionMode: 'memory',
      workspaceRoot,
      maxTurns: params.maxTurns ?? 1,
      instructions: mergedInstructions,
      modelOverride
    };
  }
}
