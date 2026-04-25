/**
 * AbstractAgentRuntime — 运行时抽象基类
 *
 * 这层的职责很克制：它只服务于“已构建完成的 runtime 实例”。
 * 它不负责：
 *   - 选择具体 runtime
 *   - 创建 builder
 *   - 组装 provider / model / thinking level
 *
 * 它负责的公共行为是：
 *   - 固化运行时身份：`id` / `type` / `name` / `options`
 *   - 提供 `stream()` 模板方法
 *   - 在模板方法里统一做快照写入与错误恢复
 *   - 提供 `run()` / `runStream()` 默认实现
 *   - 提供统一 logger
 *
 * 子类只需要关注各自 SDK 的真实执行过程。
 */

import type { AgentRuntime } from './AgentRuntime';
import type { AgentRuntimeKind, AgentRuntimeOptions, ExecutionConfig, ExecutionResult, StreamChunk } from './types';
import { saveContextSnapshot } from './ContextSnapshotWriter';
import { defaultRecoveryChain } from './ErrorRecoveryChain';

// ==================== Logger 工具 ====================

/** Runtime 内部日志接口 */
export interface RuntimeLogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

/**
 * 创建 Runtime 日志实例
 *
 * 优先使用项目 createLogger，fallback 到 console（测试环境）。
 */
export function createRuntimeLogger(moduleName: string): RuntimeLogger {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createLogger } = require('@main/common/logger');
    return createLogger(moduleName) as RuntimeLogger;
  } catch {
    const prefix = `[${moduleName}]`;
    return {
      info: (msg: string, ...args: unknown[]) => console.log(`${prefix} ${msg}`, ...args),
      warn: (msg: string, ...args: unknown[]) => console.warn(`${prefix} ${msg}`, ...args),
      error: (msg: string, ...args: unknown[]) => console.error(`${prefix} ${msg}`, ...args),
      debug: (msg: string, ...args: unknown[]) => console.debug(`${prefix} ${msg}`, ...args)
    };
  }
}

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
 * 这样可以把快照、恢复、默认执行封装收在内层，不让各 runtime 重复实现。
 */
export abstract class AbstractAgentRuntime implements AgentRuntime {
  readonly id: string;
  readonly type: AgentRuntimeKind;
  readonly name: string;
  readonly options: AgentRuntimeOptions;

  constructor(options: AgentRuntimeOptions) {
    this.options = options;
    this.type = options.type;
    this.name = options.name;
    this.id = generateRuntimeId(this.type);
  }

  // ========== 生命周期（子类必须实现） ==========

  /** 做底层 SDK / session / resource 的运行前准备，不承担 builder 组装职责 */
  abstract initialize(): Promise<void>;

  /** 释放底层资源、订阅、文件句柄或网络连接 */
  abstract destroy(): Promise<void>;

  // ========== 核心流式方法 ==========

  /**
   * 子类实现此方法 — 核心流式逻辑
   *
   * 不直接暴露给调用方，由 `stream()` 模板方法包装。
   * 子类在这里专注于“如何和具体 SDK 对接并产出标准 chunk”。
   */
  protected abstract doStream(
    input: string,
    config?: ExecutionConfig
  ): AsyncGenerator<StreamChunk, ExecutionResult, unknown>;

  /**
   * 流式执行 — 模板方法（最终暴露给调用方）
   *
   * 包装 `doStream()`，把公共控制逻辑统一收在这一层：
   *   - 正常完成后写上下文快照
   *   - 出错后按恢复链决定是否重试
   * 子类通常不需要覆盖此方法，实现 `doStream()` 即可。
   *
   * 自动行为：
   *   - 透传 doStream() 的所有 StreamChunk
   *   - 执行完成后自动调用 saveContextSnapshot()
   *   - 快照写入失败不阻断主流程
   *   - 错误时尝试渐进式恢复（重试）
   */
  async *stream(input: string, config?: ExecutionConfig): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
    const maxAttempts = 3;
    let attempt = 0;

    while (true) {
      try {
        const gen = this.doStream(input, config);
        let r = await gen.next();
        while (!r.done) {
          yield r.value;
          r = await gen.next();
        }

        const result = r.value;

        // 自动写入上下文快照（异步，不阻塞返回）
        // 从 result 中提取 rawApiRequest 并传递给 snapshot
        saveContextSnapshot(this.options, this.type, input, result, result.rawApiRequest).catch(() => {});

        return result;
      } catch (error: unknown) {
        if (!(error instanceof Error)) throw error;

        // 渐进式错误恢复（重试 / 延迟等由恢复链决定）
        const recovery = await defaultRecoveryChain.recover(error, {
          attempt,
          maxAttempts,
          sessionId: config?.sessionId as string | undefined
        });

        if (recovery.action === 'retry') {
          attempt++;
          // 延迟等待（如有）
          if (recovery.delay && recovery.delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, recovery.delay));
          }
          // 发出恢复事件
          yield {
            type: 'run:error' as const,
            content: `Recovery: ${recovery.reason}`,
            data: { recoveryAttempt: attempt }
          };
          continue; // 重试 doStream
        }

        // 不可恢复，抛出原错误
        throw error;
      }
    }
  }

  // ========== 默认实现：run ==========

  /**
   * 非流式执行 — 消费 `stream()` 收集结果
   *
   * 通过 `stream()` 模板方法执行，自动继承快照与错误恢复能力。
   * 子类一般不需要覆盖此方法。
   */
  async run(input: string, config?: ExecutionConfig): Promise<ExecutionResult> {
    const gen = this.stream(input, config);
    let r = await gen.next();
    while (!r.done) {
      r = await gen.next();
    }
    return r.value;
  }

  /**
   * 中止当前执行：实现类应将取消传递到所用 SDK（例如中止底层 Agent / HTTP）。
   * 与 `ExecutionConfig.signal` 配合使用；无在途任务时允许为空操作，可安全重复调用。
   */
  abstract abort(): void;

  // ========== 默认实现：runStream ==========

  /**
   * 流式执行（回调模式）
   *
   * 这是一个便捷包装，把 AsyncGenerator 形式转换成回调消费形式。
   * 子类一般不需要覆盖。
   */
  async runStream(
    input: string,
    config: ExecutionConfig,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<ExecutionResult> {
    const gen = this.stream(input, config);
    let r = await gen.next();
    while (!r.done) {
      onChunk(r.value);
      r = await gen.next();
    }
    return r.value;
  }
}
