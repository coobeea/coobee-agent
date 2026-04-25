/**
 * AgentRuntime 接口
 *
 * 这是 runtime 层对外暴露的核心抽象，表示一个“已经构建完成、可以执行”的运行时实例。
 * 它只负责执行与生命周期，不负责：
 *   - 选择具体 runtime 实现
 *   - 创建 builder
 *   - 注入 provider / model 默认值
 *
 * 换句话说：
 *   - Builder 负责“把运行计划组出来”
 *   - AgentRuntime 负责“按这份计划真正跑起来”
 *
 * 设计原则：
 *   1. SDK 无关：`StreamChunk` / `ExecutionResult` 等公共类型不暴露底层 SDK 细节
 *   2. 流式优先：`stream()` 是主入口；`run()` 是消费完整流后的便捷封装
 *   3. 只暴露运行期信息：身份、生命周期、执行能力；不承担 builder 工厂职责
 *
 * 使用示例：
 *   // 拉取模式（直接迭代 chunk）
 *   for await (const chunk of runtime.stream('hello')) { ... }
 *
 *   // 便捷模式（消费完整流后返回结果）
 *   const result = await runtime.run('hello');
 */

import type { AgentRuntimeKind, AgentRuntimeOptions, ExecutionConfig, ExecutionResult, StreamChunk } from './types';

/**
 * 统一运行时接口
 *
 * 当前实现：
 *   - PiMonoAgentRuntime（runtime/pimono/）— 基于 pi-coding-agent SDK
 *   - OpenAIAgentRuntime（runtime/openai/）— 基于 @openai/agents SDK
 *
 * 这里的接口重点是“如何执行”，而不是“如何被创建”。
 */
export interface AgentRuntime {
  // ========== 身份 ==========
  /** 运行时 ID */
  readonly id: string;

  /** 运行时实现类型，例如 `pi-mono`、`openai` */
  readonly type: AgentRuntimeKind;

  /** 运行时实例名称，通常来自 Agent / Thread 场景的展示名 */
  readonly name: string;

  /**
   * 构建该 runtime 时使用的只读配置快照
   *
   * 这是运行期调试与快照记录所需的元数据，不表示上层应直接操作 builder。
   */
  readonly options: AgentRuntimeOptions;

  // ========== 执行方法 ==========

  /**
   * 流式执行（主方法）
   *
   * 以 AsyncGenerator 形式产出标准化的 `StreamChunk`。
   * 调用方可以直接消费 chunk，也可以由更上层桥接到 EventBus / WebSocket / SSE。
   *
   * @param input 用户输入
   * @param config 执行配置
   * @yields StreamChunk 流式事件块
   * @returns ExecutionResult 执行结果
   */
  stream(input: string, config?: ExecutionConfig): AsyncGenerator<StreamChunk, ExecutionResult, unknown>;

  /**
   * 非流式执行（便捷方法）
   *
   * 内部调用 `stream()` 并消费完整个事件流，最终只返回 `ExecutionResult`。
   *
   * @param input 用户输入
   * @param config 执行配置
   */
  run(input: string, config?: ExecutionConfig): Promise<ExecutionResult>;

  /**
   * 中止当前进行中的执行
   *
   * 用户或调度层取消任务时调用：应触发本次 `stream` / `run` 所用的
   * `AbortSignal`，使 LLM 请求、流式消费与工具执行尽快结束。
   * 无在途执行时须为 no-op；可安全重复调用。
   */
  abort(): void;
}
