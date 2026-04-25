/**
 * AgentRuntime 接口
 *
 * 这是 runtime 层对外暴露的最小执行接口。
 * 它只表达一件事：
 *   - 给定一次输入和一份运行时选项，如何产出标准化事件流与最终结果
 *
 * 这里刻意不再暴露 initialize / destroy / builder 等生命周期细节。
 * 对外我们只保留“执行”这件事。
 */

import type { AgentRuntimeOptions, ExecutionResult, StreamChunk } from './types';

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
  // ========== 执行方法 ==========

  /**
   * 流式执行（主方法）
   *
   * 以 AsyncGenerator 形式产出标准化的 `StreamChunk`。
   * 调用方可以直接消费 chunk，也可以由更上层桥接到 EventBus / WebSocket / SSE。
   *
   * @param input 用户输入
   * @param options 本次执行使用的运行时选项
   * @yields StreamChunk 流式事件块
   * @returns ExecutionResult 执行结果
   */
  stream(input: string, options: AgentRuntimeOptions): AsyncGenerator<StreamChunk, ExecutionResult, unknown>;

  /**
   * 非流式执行（便捷方法）
   *
   * 内部调用 `stream()` 并消费完整个事件流，最终只返回 `ExecutionResult`。
   *
   * @param input 用户输入
   * @param options 本次执行使用的运行时选项
   */
  run(input: string, options: AgentRuntimeOptions): Promise<ExecutionResult>;
}
