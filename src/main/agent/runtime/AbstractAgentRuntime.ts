/**
 * AbstractAgentRuntime — 运行时抽象基类
 *
 * 这层的职责很克制：它只服务于"已构建完成的 runtime 实例"。
 * 它不负责：
 *   - 选择具体 runtime
 *   - 创建 builder
 *   - 组装 provider / model / thinking level
 *
 * 它负责的公共行为是：
 *   - 固化运行时身份：`id` / `type` / `name` / `options`
 *   - 提供 `stream()` 模板方法
 *   - 在模板方法里统一做上下文快照写入与网络错误重试
 *   - 提供 `run()` 默认实现
 *   - 提供统一 logger
 *
 * 子类只需要关注各自 SDK 的真实执行过程。
 */

import fs from 'fs';
import path from 'path';
import type { AgentRuntime } from './AgentRuntime';
import type { AgentRuntimeOptions, ExecutionResult, StreamChunk } from './types';

import { createRuntimeLogger } from './RuntimeLogger';
const log = createRuntimeLogger('runtime:context-snapshot');

// Re-export for backward compatibility
export { type RuntimeLogger, createRuntimeLogger } from './RuntimeLogger';

// ==================== ID 生成 ====================

/**
 * 生成 Runtime 唯一 ID（时间戳 + 随机后缀，同进程内足够区分实例）
 * @param prefix 通常传入 `AgentRuntimeKind`（如 `pi-mono`、`openai`）
 */
export function generateRuntimeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ==================== 抽象基类 ====================

/**
 * AgentRuntime 的模板基类
 *
 * `stream()` 是统一入口，`doStream()` 是子类扩展点。
 * 这样可以把快照、网络重试封装收在内层，不让各 runtime 重复实现。
 */
export abstract class AbstractAgentRuntime implements AgentRuntime {
  readonly options: AgentRuntimeOptions;

  constructor(options: AgentRuntimeOptions) {
    this.options = options;
  }

  /**
   * 子类实现此方法 — 核心流式逻辑
   *
   * 不直接暴露给调用方，由 `stream()` 模板方法包装。
   * 子类在这里专注于"如何和具体 SDK 对接并产出标准 chunk"。
   */
  protected abstract doStream(input: string): AsyncGenerator<StreamChunk, ExecutionResult, unknown>;

  // ========== 网络错误重试配置 ==========

  /** 最大重试次数（不含首次） */
  private static readonly MaxRetries = 5;
  /** 指数退避基数（ms） */
  private static readonly BaseDelayMs = 1000;

  /** 判断是否为可重试的网络/瞬时错误 */
  private static isTransientError(error: Error): boolean {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('timeout') ||
      msg.includes('econnreset') ||
      msg.includes('econnrefused') ||
      msg.includes('socket hang up') ||
      msg.includes('network') ||
      msg.includes('rate limit') ||
      msg.includes('429') ||
      msg.includes('too many requests') ||
      msg.includes('500') ||
      msg.includes('502') ||
      msg.includes('503') ||
      msg.includes('service unavailable')
    );
  }

  /**
   * 流式执行 — 模板方法（最终暴露给调用方）
   *
   * 包装 `doStream()`，把公共控制逻辑统一收在这一层：
   *   - 正常完成后写上下文快照
   *   - 网络/瞬时错误自动指数退避重试
   * 子类通常不需要覆盖此方法，实现 `doStream()` 即可。
   */
  async *stream(input: string): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
    const options = this.options;
    let attempt = 0;

    while (true) {
      try {
        const gen = this.doStream(input);
        let r = await gen.next();
        while (!r.done) {
          yield r.value;
          r = await gen.next();
        }

        const result = r.value;

        // 异步写入上下文快照，不阻塞返回
        AbstractAgentRuntime.writeSnapshot(options, options.type, input, result).catch(() => {});

        return result;
      } catch (error: unknown) {
        if (!(error instanceof Error)) throw error;

        if (AbstractAgentRuntime.isTransientError(error) && attempt < AbstractAgentRuntime.MaxRetries) {
          const delay = AbstractAgentRuntime.BaseDelayMs * Math.pow(2, attempt);
          attempt++;
          await new Promise((resolve) => setTimeout(resolve, delay));
          yield {
            type: 'run:error' as const,
            content: `网络错误，${delay}ms 后重试 (第 ${attempt}/${AbstractAgentRuntime.MaxRetries} 次)`,
            data: { recoveryAttempt: attempt }
          };
          continue;
        }

        throw error;
      }
    }
  }

  // ========== 上下文快照写入 ==========

  /**
   * 将当前 LLM 调用的输入/输出写入 context.jsonl
   *
   * 写入失败不阻断执行，仅记录警告。
   */
  private static async writeSnapshot(
    options: AgentRuntimeOptions,
    runtimeType: string,
    input: string,
    result: ExecutionResult
  ): Promise<void> {
    const contextDir = options.contextDir;
    if (!contextDir) return;

    try {
      if (!fs.existsSync(contextDir)) {
        fs.mkdirSync(contextDir, { recursive: true });
      }

      const snapshot = {
        timestamp: new Date().toISOString(),
        sessionId: options.sessionId || 'unknown',
        runtime: runtimeType,
        config: {
          name: options.name,
          model: options.model || 'unknown',
          instructions: options.instructions,
          ...(options.appendInstructions?.length ? { appendInstructions: options.appendInstructions } : {}),
          ...(options.skills?.length
            ? { skills: options.skills.map((s) => ({ name: s.name, description: s.description })) }
            : {}),
          ...(options.tools?.length
            ? { tools: options.tools.map((t) => ({ name: t.name, description: t.description })) }
            : {})
        },
        userMessage: input,
        output: result.output,
        ...(result.error ? { error: result.error } : {}),
        ...(result.toolCalls?.length ? { toolCalls: result.toolCalls } : {}),
        ...(result.duration !== undefined ? { duration: result.duration } : {}),
        ...(result.rawApiRequest ? { rawApiRequest: result.rawApiRequest } : {})
      };

      const filepath = path.join(contextDir, 'context.jsonl');
      await fs.promises.appendFile(filepath, JSON.stringify(snapshot) + '\n', 'utf-8');
    } catch (error) {
      log.warn('[ContextSnapshot] Write failed:', error);
    }
  }

  // ========== 默认实现：run / lifecycle ==========

  /**
   * 非流式执行 — 消费 `stream()` 收集结果
   */
  async run(input: string): Promise<ExecutionResult> {
    const gen = this.stream(input);
    let r = await gen.next();
    while (!r.done) {
      r = await gen.next();
    }
    return r.value;
  }
}
