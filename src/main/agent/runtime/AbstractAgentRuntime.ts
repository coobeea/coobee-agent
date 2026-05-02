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
 *   - 提供 `stream()` → 委托 `doStream()`
 *   - 提供 `run()` 默认实现（消费 stream）
 *   - 提供统一 logger
 *
 * 网络重试由各 SDK 自行负责（Pi Mono: SettingsManager.retry；OpenAI: ModelRetrySettings）。
 *
 * 子类只需要关注各自 SDK 的真实执行过程。
 */

import type { AgentRuntime } from './AgentRuntime';
import type { AgentRuntimeOptions, AgentExecutionResult, AgentStreamChunk } from './types';

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
 * `stream()` 委托 `doStream()`，子类实现 `doStream()` 即可。
 *
 * 网络重试不在此层处理，由各 SDK 各自负责：
 *   - Pi Mono: SettingsManager.retry（auto_retry_start / auto_retry_end 事件）
 *   - OpenAI:  ModelRetrySettings + retryPolicies
 */
export abstract class AbstractAgentRuntime implements AgentRuntime {
  readonly options: AgentRuntimeOptions;

  constructor(options: AgentRuntimeOptions) {
    this.options = options;
  }

  /**
   * 子类实现此方法 — 核心流式逻辑
   */
  protected abstract doStream(input: string): AsyncGenerator<AgentStreamChunk, AgentExecutionResult, unknown>;

  /**
   * 流式执行 — 委托 doStream()
   */
  stream(input: string): AsyncGenerator<AgentStreamChunk, AgentExecutionResult, unknown> {
    return this.doStream(input);
  }

  /**
   * 非流式执行 — 消费 stream() 收集结果
   */
  async run(input: string): Promise<AgentExecutionResult> {
    const gen = this.stream(input);
    let r = await gen.next();
    while (!r.done) {
      r = await gen.next();
    }
    return r.value;
  }
}
