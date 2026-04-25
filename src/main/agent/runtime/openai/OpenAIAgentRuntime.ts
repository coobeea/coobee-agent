/**
 * OpenAI Agent 运行时
 *
 * 基于 OpenAI Agents SDK 实现 AgentRuntime 接口。
 *
 * 核心能力：
 * - 纯参数驱动：name, instructions, tools 全部由调用方传入
 * - FileSession：JSONL 持久化，带序号的 SessionItem 格式（智能上下文构建）
 * - 完整流式事件：覆盖 doc 15 所有 RunStreamEvent（text, reasoning, tool, handoff, approval 等）
 * - HITL 工具审批：暂停/审批/恢复执行流程
 * - Handoff 支持：SDK 原生 Agent 间切换
 * - maxTurns：防止无限工具调用循环
 */

import { run, Agent, tool } from '@openai/agents';
import type { StreamedRunResult, Tool } from '@openai/agents';
import { FileSession } from './FileSession';
import { ThinkTagParser, stripThinkTags } from './ThinkTagParser';
import { AbstractAgentRuntime, createRuntimeLogger } from '../AbstractAgentRuntime';
import {
  buildInstructions,
  type AgentRuntimeOptions,
  type ExecutionResult,
  type StreamChunk,
  type ToolDefinition
} from '../types';
import { createFallbackToolContext } from '../shared/ToolExecutionPipeline';

/** 默认最大执行轮次 */
const DEFAULT_MAX_TURNS = 25;

/** 默认模型 */
const DEFAULT_MODEL = 'gpt-4o';

const log = createRuntimeLogger('agent-runtime');

/**
 * OpenAI Agent 运行时
 *
 * 基于 OpenAI Agents SDK 实现 AgentRuntime 接口。
 *
 * 职责：
 * 1. 根据传入的配置创建 SDK Agent
 * 2. 通过 FileSession 管理对话历史持久化
 * 3. 执行 Agent（同步/流式），输出完整的流式事件
 * 4. 处理 HITL 工具审批的暂停/恢复
 */
export class OpenAIAgentRuntime extends AbstractAgentRuntime {
  constructor(options: AgentRuntimeOptions) {
    super(options);
  }

  // ========== 执行方法 ==========

  // run() 由基类 AbstractAgentRuntime 提供（消费 stream()，自动继承快照功能）

  /**
   * 流式执行 Agent（核心实现 — 由基类 stream() 模板方法包装）
   *
   * 8 层闭环事件输出：
   *   run:start → turn:start → llm:start → { text:*, reasoning:*, tool:* } → llm:done → turn:done → run:done
   *
   * SDK 的 StreamedRunResult 本身是 AsyncIterable，直接 for await + yield。
   */
  protected async *doStream(
    input: string,
    options: AgentRuntimeOptions
  ): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
    const runtimeOptions = options;
    const pendingRuntimeChunks: StreamChunk[] = [];
    const allTools: Tool[] = [
      ...(runtimeOptions.sdkTools || []),
      ...this.convertTools(runtimeOptions.tools || [], runtimeOptions, pendingRuntimeChunks, runtimeOptions.signal)
    ];
    const finalInstructions = buildInstructions(
      runtimeOptions.instructions,
      runtimeOptions.skills,
      runtimeOptions.appendInstructions
    );
    const sessionId = runtimeOptions.sessionId || `session-${Date.now()}`;
    const agent = new Agent({
      name: runtimeOptions.name,
      instructions: finalInstructions,
      model: runtimeOptions.model || DEFAULT_MODEL,
      ...(allTools.length > 0 ? { tools: allTools } : {})
    });
    const session = new FileSession(sessionId, runtimeOptions.sessionDir);

    log.info(
      `Initialized: ${runtimeOptions.name} ` +
        `(tools: ${allTools.length}, ` +
        `skills: ${runtimeOptions.skills?.length || 0}, ` +
        `session: ${sessionId})`
    );

    const startTime = Date.now();
    const maxTurns = options.maxTurns ?? runtimeOptions.maxTurns ?? DEFAULT_MAX_TURNS;

    log.info(`Running stream: ${runtimeOptions.name}`);

    try {
      // 1. run:start
      yield { type: 'run:start', content: '' };

      // 2. SDK 流式执行
      const streamRunResult = await run(agent, input, {
        stream: true,
        session,
        maxTurns,
        signal: runtimeOptions.signal
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const streamResult = streamRunResult as StreamedRunResult<unknown, any>;

      // 3. 消费流事件（AsyncGenerator — 直接 yield）
      let fullOutput = '';
      let apiError: string | null = null;
      for await (const chunk of this.generateStreamEvents(
        streamResult,
        (text) => {
          fullOutput += text;
        },
        (errorMessage) => {
          apiError = errorMessage;
        },
        () => this.drainPendingRuntimeChunks(pendingRuntimeChunks)
      )) {
        yield chunk;
      }

      // 4. 等待完成
      await streamResult.completed;
      // 与 PiMono 对齐：给尾部异步回调一个微任务周期，避免最后一批 tool:delta 丢失
      await Promise.resolve();
      for (const chunk of this.drainPendingRuntimeChunks(pendingRuntimeChunks)) {
        yield chunk;
      }

      // HITL 审批现在由 tool-approval Extension 在 prepare_tool_call Hook 中处理，
      // 不再依赖 SDK 的 interruptions 机制。

      const rawOutput = (streamResult.finalOutput as string) || fullOutput;
      const output = stripThinkTags(rawOutput) || rawOutput;

      // 7. run:done
      yield { type: 'run:done', content: '' };

      const duration = Date.now() - startTime;

      return {
        output,
        ...(apiError ? { error: apiError } : {}),
        toolCalls: this.extractToolCalls(streamResult.newItems),
        duration,
        metadata: {
          agentId: runtimeOptions.type,
          sessionId
        }
      };
    } catch (error: unknown) {
      yield {
        type: 'run:error',
        content: error instanceof Error ? error.message : String(error),
        data: { message: error instanceof Error ? error.message : String(error) }
      };
      log.error(`Stream execution failed:`, error);
      throw error;
    } finally {
      pendingRuntimeChunks.length = 0;
    }
  }

  // runStream() 由基类 AbstractAgentRuntime 提供
  // HITL 审批由 tool-approval Extension 在 prepare_tool_call Hook 中处理

  // ========== 内部方法 ==========

  /**
   * SDK 流事件 → StreamChunk AsyncGenerator
   *
   * 嵌套关系：
   *   run ⊃ turn ⊃ llm ⊃ { reasoning, text, tool } + hitl + handoff
   *
   * 关键改进（v2）：
   *   通过 ThinkTagParser 将 <think>...</think> 标签实时拆分为
   *   独立的 reasoning:start/delta/done 事件，text:delta 只包含纯净文本。
   *   前端零解析负担。
   *
   * 内部使用缓冲数组收集 ThinkTagParser 回调产生的同步 chunk，
   * 然后在每次 SDK 事件迭代后 yield 所有收集的 chunk。
   */
  private async *generateStreamEvents(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    streamResult: StreamedRunResult<unknown, any>,
    onTextDelta: (text: string) => void,
    onApiError: (errorMessage: string) => void,
    drainPendingRuntimeChunks: () => StreamChunk[]
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const state = {
      turnIndex: 0,
      turnOpen: false,
      textStartEmitted: false,
      reasoningStartEmitted: false,
      fullReasoningText: ''
    };

    // 同步缓冲：ThinkTagParser 回调产生的 chunk 先存这里，每轮 yield
    const buffer: StreamChunk[] = [];
    const emit = (chunk: StreamChunk): void => {
      buffer.push(chunk);
    };

    // ---- ThinkTagParser：实时拆分 <think> 标签 ----
    const thinkParser = new ThinkTagParser({
      onText: (text) => {
        if (!state.textStartEmitted) {
          state.textStartEmitted = true;
          emit({ type: 'text:start', content: '' });
        }
        onTextDelta(text);
        emit({ type: 'text:delta', content: text, data: { delta: text } });
      },

      onReasoningStart: () => {
        if (!state.reasoningStartEmitted) {
          state.reasoningStartEmitted = true;
          emit({ type: 'reasoning:start', content: '' });
        }
      },

      onReasoning: (text) => {
        state.fullReasoningText += text;
        emit({ type: 'reasoning:delta', content: text, data: { delta: text } });
      },

      onReasoningDone: () => {
        emit({
          type: 'reasoning:done',
          content: '',
          data: { rawContent: state.fullReasoningText }
        });
      }
    });

    for await (const event of streamResult) {
      // 清空缓冲
      buffer.length = 0;

      // ---- debug 日志：记录原始 SDK 事件 ----
      this.logStreamEvent(event);

      switch (event.type) {
        case 'raw_model_stream_event':
          this.handleRawModelStreamEvent(event, state, thinkParser, emit, onApiError);
          break;
        case 'run_item_stream_event':
          this.handleRunItemStreamEvent(event, emit);
          break;
        case 'agent_updated_stream_event':
          this.handleAgentUpdatedStreamEvent(event, emit);
          break;
      }

      // yield 本轮收集的所有 chunk
      for (const chunk of [...buffer, ...drainPendingRuntimeChunks()]) {
        yield chunk;
      }
    }

    // 关闭最后一轮
    if (state.turnOpen) {
      buffer.length = 0;
      thinkParser.flush();
      // flush 可能产生额外 chunk
      for (const chunk of [...buffer, ...drainPendingRuntimeChunks()]) {
        yield chunk;
      }
      yield { type: 'turn:done', content: '', data: { turnIndex: state.turnIndex } };
    }

    for (const chunk of drainPendingRuntimeChunks()) {
      yield chunk;
    }
  }

  /**
   * 记录原始 SDK 事件的 debug 日志
   */
  private logStreamEvent(event: { type: string; data?: unknown; item?: unknown; name?: string }): void {
    if (event.type === 'raw_model_stream_event') {
      const rawEvent = event.data as { type?: string; event?: { type?: string } } | undefined;
      const rawType = rawEvent?.type;
      const innerType = rawType === 'model' ? rawEvent?.event?.type : undefined;
      log.debug(
        `[SDK Event] ${event.type} | rawType=${rawType}${innerType ? ` | innerType=${innerType}` : ''}`,
        JSON.stringify(event.data)
      );
    } else if (event.type === 'run_item_stream_event') {
      const itemType = (event.item as { type?: string })?.type;
      log.debug(
        `[SDK Event] ${event.type} | name=${event.name} | itemType=${itemType}`,
        JSON.stringify((event.item as { rawItem?: unknown })?.rawItem ?? event.item)
      );
    } else {
      log.debug(`[SDK Event] ${event.type}`, JSON.stringify(event));
    }
  }

  /**
   * 处理 raw_model_stream_event：response_started、output_text_delta、response_done
   */
  private handleRawModelStreamEvent(
    event: { type: 'raw_model_stream_event'; data?: unknown },
    state: {
      turnIndex: number;
      turnOpen: boolean;
      textStartEmitted: boolean;
      reasoningStartEmitted: boolean;
      fullReasoningText: string;
    },
    thinkParser: ThinkTagParser,
    emit: (chunk: StreamChunk) => void,
    onApiError: (errorMessage: string) => void
  ): void {
    const rawEvent = event.data;
    if (!rawEvent || typeof rawEvent !== 'object') return;
    const rawType = (rawEvent as { type?: string }).type;

    // response_started → 关上一轮 + 开新一轮 + llm:start
    if (rawType === 'response_started') {
      thinkParser.flush();

      if (state.turnOpen) {
        emit({ type: 'turn:done', content: '', data: { turnIndex: state.turnIndex } });
      }
      state.turnIndex++;
      state.turnOpen = true;
      state.textStartEmitted = false;
      state.reasoningStartEmitted = false;
      state.fullReasoningText = '';
      thinkParser.reset();
      emit({ type: 'turn:start', content: '', data: { turnIndex: state.turnIndex } });
      emit({ type: 'llm:start', content: '' });
    }

    // output_text_delta → 通过 ThinkTagParser 分流
    if (rawType === 'output_text_delta') {
      const delta = (rawEvent as { delta?: string }).delta || '';
      if (delta) {
        thinkParser.feed(delta);
      }
    }

    // response_done → 关闭 reasoning/text + llm:done（携带 usage）
    if (rawType === 'response_done') {
      thinkParser.flush();

      const response = (rawEvent as { response?: Record<string, unknown> }).response;
      const usage = response?.usage as
        | { inputTokens?: number; outputTokens?: number; totalTokens?: number }
        | undefined;

      if (state.reasoningStartEmitted && thinkParser.isInThinking) {
        emit({
          type: 'reasoning:done',
          content: '',
          data: { rawContent: state.fullReasoningText }
        });
      }

      if (state.textStartEmitted) {
        const outputs = response?.output as
          | Array<{
              type?: string;
              content?: Array<{ text?: string }>;
            }>
          | undefined;
        const msgOutput = outputs?.find((o) => o.type === 'message');
        const rawFullText = msgOutput?.content?.map((c) => c.text || '').join('') || '';
        const cleanText = stripThinkTags(rawFullText);
        emit({ type: 'text:done', content: cleanText, data: { text: cleanText } });
      }

      emit({
        type: 'llm:done',
        content: '',
        data: {
          responseId: response?.id as string | undefined,
          usage: usage
            ? {
                inputTokens: usage.inputTokens || 0,
                outputTokens: usage.outputTokens || 0,
                totalTokens: usage.totalTokens || 0
              }
            : undefined
        }
      });
    }

    // 某些服务端错误只出现在流事件里，不会由 SDK 抛异常
    if (rawType === 'response_failed' || rawType === 'error') {
      const errMsg =
        (rawEvent as { error?: { message?: string }; message?: string }).error?.message ||
        (rawEvent as { message?: string }).message ||
        'Model response failed';
      onApiError(errMsg);
      emit({
        type: 'run:error',
        content: errMsg,
        data: { message: errMsg }
      });
    }
  }

  /**
   * 处理 run_item_stream_event：tool_called、tool_output、handoff_requested、handoff_occurred
   */
  private handleRunItemStreamEvent(
    event: { type: 'run_item_stream_event'; item?: unknown; name?: string },
    emit: (chunk: StreamChunk) => void
  ): void {
    const item = event.item;
    if (!item) return;
    const eventName = event.name;

    // tool_called → tool:start
    if (eventName === 'tool_called' && (item as { type?: string }).type === 'tool_call_item') {
      const rawItem = (item as { rawItem?: Record<string, unknown> }).rawItem;
      const toolName = (rawItem as { name?: string })?.name || 'unknown';
      const callId = (rawItem as { call_id?: string })?.call_id;
      const args = (rawItem as { arguments?: unknown })?.arguments;
      emit({ type: 'tool:start', content: toolName, data: { toolName, callId, arguments: args } });
    }

    // tool_output → tool:done
    if (eventName === 'tool_output') {
      const rawItem = (item as { rawItem?: Record<string, unknown> }).rawItem || {};
      const toolName = (rawItem as { name?: string }).name || 'unknown';
      const callId =
        (rawItem as { callId?: string; call_id?: string }).callId || (rawItem as { call_id?: string }).call_id;
      const output = (item as { output?: string }).output || (rawItem as { output?: string }).output || '';
      emit({
        type: 'tool:done',
        content: typeof output === 'string' ? output : JSON.stringify(output),
        data: { toolName, callId, output }
      });
    }

    // handoff: 请求
    if (eventName === 'handoff_requested') {
      const agentName = (item as unknown as { agent?: { name?: string } }).agent?.name || 'unknown';
      emit({
        type: 'handoff:start',
        content: `Handoff to ${agentName}`,
        data: { toAgent: agentName }
      });
    }

    // handoff: 完成
    if (eventName === 'handoff_occurred') {
      const targetAgent =
        (item as unknown as { targetAgent?: { name?: string } }).targetAgent?.name ||
        (item as unknown as { agent?: { name?: string } }).agent?.name ||
        'unknown';
      emit({
        type: 'handoff:done',
        content: `Switched to ${targetAgent}`,
        data: { toAgent: targetAgent }
      });
    }

    // hitl 审批现在由 tool-approval Extension 处理，不再在 SDK 事件层拦截
  }

  /**
   * 处理 agent_updated_stream_event：Agent 切换通知
   */
  private handleAgentUpdatedStreamEvent(
    event: {
      type: 'agent_updated_stream_event';
      agent?: { name?: string };
    },
    emit: (chunk: StreamChunk) => void
  ): void {
    const agentName = event.agent?.name || 'unknown';
    emit({
      type: 'agent:updated',
      content: `Agent updated: ${agentName}`,
      data: {
        agentName
      }
    });
  }

  /**
   * 从 RunItem[] 中提取工具调用记录
   */
  private extractToolCalls(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    newItems: any[]
  ): ExecutionResult['toolCalls'] {
    if (!newItems) return [];

    return (
      newItems
        .filter(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (item: any) => item.type === 'tool_call_item' && item.rawItem?.type === 'function_call'
        )
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((item: any) => {
          const rawItem = item.rawItem;
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(rawItem.arguments || '{}') as Record<string, unknown>;
          } catch {
            // ignore
          }
          return {
            toolName: rawItem.name || 'unknown',
            arguments: parsedArgs,
            result: rawItem.output
          };
        })
    );
  }

  /**
   * 将统一 ToolDefinition 转换为 @openai/agents SDK 原生 Tool
   *
   * 核心映射：
   *   - execute 前通过 prepare_tool_call Hook 处理审批（tool-approval Extension）
   *   - execute 前检查工具策略（isToolAllowed，sandbox 级别拦截）
   *   - yield 的 ToolStreamUpdate 通过 StreamEmitter 发送 tool:delta 事件给前端
   *   - return 的 ToolResult.llmContent 作为工具返回值发送回 LLM
   *   - 自动注入 ToolExecutionContext（路径守卫、工具策略、Agent 信息等）
   *
   * HITL 审批：
   *   不再使用 SDK 的 needsApproval 机制，改由 tool-approval Extension
   *   在 prepare_tool_call Hook 中统一处理（适用于所有 Runtime）。
   */
  private convertTools(
    defs: ToolDefinition[],
    options: AgentRuntimeOptions,
    pendingRuntimeChunks: StreamChunk[],
    signal?: AbortSignal
  ): Tool[] {
    if (!defs.length) return [];

    // 优先使用注入的工具执行上下文，否则降级为最小上下文
    const sandboxContext =
      options.sandboxContext ||
      createFallbackToolContext({
        workspaceRoot: options.workspaceRoot || process.cwd(),
        sessionId: options.sessionId || 'session'
      });

    return defs.map((def) =>
      tool({
        name: def.name,
        description: def.description,
        parameters: def.parameters,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        execute: async (params: any) => {
          // 使用共享管线：hook + policy + execute + post-hooks
          const { executeToolPipeline } = await import('../shared/ToolExecutionPipeline');
          const result = await executeToolPipeline(def, params as Record<string, unknown>, {
            sandboxContext,
            onUpdate: (update) => {
              // 工具增量输出也回到 yield 链路，由 AgentExecutor 统一广播和持久化。
              pendingRuntimeChunks.push({
                type: 'tool:delta',
                content: update.content,
                data: { delta: update.content }
              });
            },
            signal
          });
          return result.resultText;
        }
      })
    );
  }

  private drainPendingRuntimeChunks(pendingRuntimeChunks: StreamChunk[]): StreamChunk[] {
    if (pendingRuntimeChunks.length === 0) return [];
    const chunks = [...pendingRuntimeChunks];
    pendingRuntimeChunks.length = 0;
    return chunks;
  }
}
