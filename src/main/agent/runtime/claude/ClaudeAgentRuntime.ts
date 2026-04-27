/**
 * Claude Agent 运行时
 *
 * 基于 @anthropic-ai/claude-agent-sdk 接入 Claude Code 能力，并统一翻译为
 * Runtime 层的 StreamChunk / ExecutionResult 协议。
 */

import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type {
  Options,
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
  CanUseTool,
  PermissionResult
} from '@anthropic-ai/claude-agent-sdk';
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';

import { AbstractAgentRuntime, createRuntimeLogger } from '../AbstractAgentRuntime';
import {
  buildInstructions,
  type AgentRuntimeOptions,
  type ExecutionResult,
  type StreamChunk,
  type ThinkingLevel
} from '../types';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

const log = createRuntimeLogger('claude-runtime');

type UnknownRecord = Record<string, unknown>;

/** 运行时累积的 session 统计信息 */
interface ClaudeSessionStats {
  compactCount: number;
  taskCount: number;
  rateLimitHits: number;
  lastCompactAt?: number;
}

interface MessageChannel {
  enqueue(message: SDKUserMessage): void;
  generator: AsyncGenerator<SDKUserMessage>;
  close(): void;
}

interface ToolBlockState {
  id: string;
  name: string;
  initialInput?: Record<string, unknown>;
  inputJson: string;
}

interface ClaudeStreamState {
  sdkSessionId?: string;
  fullOutput: string;
  fullReasoning: string;
  sawPartialText: boolean;
  textStarted: boolean;
  textDone: boolean;
  reasoningStarted: boolean;
  reasoningDone: boolean;
  toolBlocks: Map<number, ToolBlockState>;
  toolCalls: NonNullable<ExecutionResult['toolCalls']>;
  /** session 级统计 */
  stats: ClaudeSessionStats;
}

function createMessageChannel(signal: AbortSignal): MessageChannel {
  const queue: SDKUserMessage[] = [];
  let resolver: (() => void) | null = null;
  let done = signal.aborted;

  const wake = (): void => {
    if (!resolver) return;
    const resolve = resolver;
    resolver = null;
    resolve();
  };

  const onAbort = (): void => {
    done = true;
    wake();
  };

  if (!done) {
    signal.addEventListener('abort', onAbort, { once: true });
  }

  async function* generator(): AsyncGenerator<SDKUserMessage> {
    try {
      while (!done) {
        const next = queue.shift();
        if (next) {
          yield next;
          continue;
        }
        await new Promise<void>((resolve) => {
          resolver = resolve;
        });
      }

      let next = queue.shift();
      while (next) {
        yield next;
        next = queue.shift();
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  return {
    enqueue: (message) => {
      queue.push(message);
      wake();
    },
    generator: generator(),
    close: () => {
      done = true;
      wake();
    }
  };
}

export class ClaudeAgentRuntime extends AbstractAgentRuntime {
  private activeQuery: Query | null = null;
  private activeController: AbortController | null = null;

  constructor(options: AgentRuntimeOptions) {
    super(options);
  }

  protected async *doStream(input: string): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
    const options = this.options;
    const startTime = Date.now();
    const finalInstructions = buildInstructions(options.instructions, options.skills, options.appendInstructions);
    const cwd = options.workspaceRoot || process.cwd();
    const sessionId = options.sessionId || `session-${Date.now()}`;
    const sdkSessionId = options.sessionMode === 'file' ? this.toStableUuid(sessionId) : undefined;
    const controller = new AbortController();
    const channel = createMessageChannel(controller.signal);
    const state = this.createStreamState(sdkSessionId);
    const rawApiRequest = this.buildRequestPreview(input, options, finalInstructions, sdkSessionId);

    this.activeController = controller;

    const abortFromCaller = (): void => {
      controller.abort();
      this.activeQuery?.close();
      channel.close();
    };

    if (options.signal) {
      if (options.signal.aborted) {
        abortFromCaller();
      } else {
        options.signal.addEventListener('abort', abortFromCaller, { once: true });
      }
    }

    try {
      const sdk = await import('@anthropic-ai/claude-agent-sdk');
      const sdkOptions = this.buildSdkOptions({
        options,
        cwd,
        controller,
        finalInstructions,
        sdkSessionId
      });

      channel.enqueue({
        type: 'user',
        session_id: sdkSessionId,
        message: {
          role: 'user',
          content: input
        },
        parent_tool_use_id: null
      });

      const query = sdk.query({
        prompt: channel.generator,
        options: sdkOptions
      });
      this.activeQuery = query;

      log.info(
        `Initialized: ${options.name} ` +
          `(api: anthropic, model: ${sdkOptions.model || DEFAULT_MODEL}, ` +
          `cwd: ${cwd}, session: ${sessionId})`
      );

      yield { type: 'run:start', content: '' };
      yield { type: 'turn:start', content: '' };
      yield { type: 'llm:start', content: '' };

      let resultMessage: SDKResultMessage | null = null;

      for await (const sdkMessage of query) {
        const chunks = this.mapSdkMessage(sdkMessage, state);
        for (const chunk of chunks) {
          yield chunk;
        }

        if (sdkMessage.type === 'result') {
          resultMessage = sdkMessage;
          channel.close();
        }
      }

      if (!resultMessage && controller.signal.aborted) {
        yield { type: 'run:interrupted', content: 'Execution cancelled by user' };
        return {
          output: state.fullOutput,
          interrupted: true,
          error: 'Aborted by user',
          duration: Date.now() - startTime,
          metadata: { sessionId, sdkSessionId },
          rawApiRequest
        };
      }

      const result = this.buildResult(resultMessage, state, startTime, sessionId, rawApiRequest);
      for (const chunk of this.buildCompletionChunks(resultMessage, state)) {
        yield chunk;
      }
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      yield {
        type: controller.signal.aborted ? 'run:interrupted' : 'run:error',
        content: controller.signal.aborted ? 'Execution cancelled by user' : message,
        data: { message }
      };

      if (controller.signal.aborted) {
        return {
          output: state.fullOutput,
          interrupted: true,
          error: 'Aborted by user',
          duration: Date.now() - startTime,
          metadata: { sessionId, sdkSessionId },
          rawApiRequest
        };
      }

      log.error('Stream execution failed:', error);
      throw error;
    } finally {
      channel.close();
      if (options.signal) {
        options.signal.removeEventListener('abort', abortFromCaller);
      }
      this.activeQuery = null;
      this.activeController = null;
    }
  }

  async destroy(): Promise<void> {
    try {
      this.activeQuery?.close();
    } catch (error) {
      log.warn('Failed to close active Claude query:', error);
    }
    this.activeController?.abort();
    this.activeQuery = null;
    this.activeController = null;
  }

  private buildSdkOptions(args: {
    options: AgentRuntimeOptions;
    cwd: string;
    controller: AbortController;
    finalInstructions: string;
    sdkSessionId?: string;
  }): Options {
    const { options, cwd, controller, finalInstructions, sdkSessionId } = args;
    const effort = this.mapThinkingLevel(options.thinkingLevel);
    const thinking: Options['thinking'] =
      options.thinkingLevel === 'minimal' ? { type: 'disabled' } : { type: 'adaptive' };

    const sdkOptions: Options = {
      model: options.model || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      maxTurns: options.maxTurns,
      cwd,
      abortController: controller,
      env: this.buildClaudeEnv(options),
      includePartialMessages: true,
      promptSuggestions: false,
      permissionMode: this.resolvePermissionMode(options),
      allowDangerouslySkipPermissions: false,
      settingSources: ['user', 'project'],
      tools: { type: 'preset', preset: 'claude_code' },
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: finalInstructions
      },
      thinking,
      ...(effort ? { effort } : {}),
      ...(sdkSessionId ? { sessionId: sdkSessionId } : {}),
      canUseTool: this.buildCanUseTool(options),
      stderr: (data: string) => {
        log.debug(`[claude-stderr] ${data.trim()}`);
      }
    };

    return sdkOptions;
  }

  private buildClaudeEnv(options: AgentRuntimeOptions): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = {
      ...process.env,
      CLAUDE_AGENT_SDK_CLIENT_APP: 'coobee-agent/1.0.0'
    };

    if (options.apiKey) {
      if (options.apiKey.startsWith('sk-ant-sid')) {
        env.ANTHROPIC_AUTH_TOKEN = options.apiKey;
      } else {
        env.ANTHROPIC_API_KEY = options.apiKey;
      }
    }

    if (options.baseURL) {
      env.ANTHROPIC_BASE_URL = options.baseURL;
    }

    if (options.sessionDir) {
      const claudeConfigDir = join(options.sessionDir, 'claude');
      mkdirSync(claudeConfigDir, { recursive: true });
      env.CLAUDE_CONFIG_DIR = claudeConfigDir;
    }

    return env;
  }

  /**
   * 根据运行时选项解析合适的 permissionMode
   *
   * - agent 模式默认 acceptEdits（允许编辑文件，但对危险操作仍需确认）
   * - chat 模式下可考虑更严格的 'default'
   */
  private resolvePermissionMode(_options: AgentRuntimeOptions): PermissionMode {
    return 'acceptEdits';
  }

  /**
   * 构建 canUseTool 回调 — 接入沙箱工具策略
   *
   * 在 Claude SDK 每次执行工具前调用，检查：
   *   1. 沙箱 toolPolicy 是否允许
   *   2. 内置工具默认放行
   *
   * 未配置策略或策略检查失败时，默认 allow（由 Claude SDK 自身的权限提示兜底）。
   */
  private buildCanUseTool(options: AgentRuntimeOptions): CanUseTool {
    const toolPolicy = options.sandboxContext?.toolPolicy;

    return async (toolName, _input, _callOptions) => {
      // 无策略配置：全部放行（SDK 会自行按 permissionMode 处理）
      if (!toolPolicy || !toolPolicy.allow || toolPolicy.allow.length === 0) {
        return { behavior: 'allow' } as PermissionResult;
      }

      // 检查拒绝列表
      if (toolPolicy.deny && toolPolicy.deny.some((p) => matchToolPattern(toolName, p))) {
        log.warn(`[canUseTool] Denied by policy: ${toolName}`);
        return {
          behavior: 'deny',
          message: `Tool "${toolName}" is blocked by sandbox policy`
        } as PermissionResult;
      }

      // 检查允许列表（非空时按白名单模式）
      const isAllowed = toolPolicy.allow.some((p) => matchToolPattern(toolName, p));
      if (!isAllowed) {
        log.warn(`[canUseTool] Not in allowlist: ${toolName}`);
        return {
          behavior: 'deny',
          message: `Tool "${toolName}" is not in the allowed list`
        } as PermissionResult;
      }

      return { behavior: 'allow' } as PermissionResult;
    };
  }

  private mapSdkMessage(message: SDKMessage, state: ClaudeStreamState): StreamChunk[] {
    this.captureSdkSessionId(message, state);

    if (message.type === 'stream_event') {
      return this.mapStreamEvent(message.event, state);
    }

    if (message.type === 'assistant') {
      return this.mapAssistantMessage(message, state);
    }

    if (message.type === 'system') {
      return this.mapSystemMessage(message, state);
    }

    if (message.type === 'auth_status' && message.error) {
      return [{ type: 'run:error', content: message.error, data: { message: message.error } }];
    }

    if (message.type === 'rate_limit_event') {
      return this.mapRateLimit(message, state);
    }

    if (message.type === 'tool_progress') {
      return this.mapToolProgress(message);
    }

    if (message.type === 'prompt_suggestion') {
      return this.mapPromptSuggestion(message);
    }

    return [];
  }

  /**
   * 分发 system 消息 — 按 subtype 路由到具体处理函数
   */
  private mapSystemMessage(message: Extract<SDKMessage, { type: 'system' }>, state: ClaudeStreamState): StreamChunk[] {
    const subtype = (message as UnknownRecord).subtype as string | undefined;

    if (subtype === 'init') {
      return this.mapSystemInit(message);
    }

    if (subtype === 'compact_boundary') {
      return this.mapCompactBoundary(message, state);
    }

    if (subtype === 'task_started') {
      return this.mapTaskStarted(message, state);
    }

    if (subtype === 'task_progress') {
      return this.mapTaskProgress(message);
    }

    if (subtype === 'task_notification') {
      return this.mapTaskNotification(message, state);
    }

    if (subtype === 'tool_progress') {
      return this.mapToolProgress(message);
    }

    // hook 相关事件（如果启用了 includeHookEvents）
    if (subtype === 'hook_started' || subtype === 'hook_response') {
      return this.mapHookMessage(message);
    }

    return [];
  }

  private mapSystemInit(message: SDKMessage): StreamChunk[] {
    const record = asRecord(message) || {};
    return [
      {
        type: 'agent:updated',
        content: '',
        data: {
          sdk: 'claude-agent-sdk',
          model: stringValue(record, 'model'),
          tools: record.tools
        }
      }
    ];
  }

  /** 压缩边界消息 → compression:done（携带摘要信息） */
  private mapCompactBoundary(message: SDKMessage, state: ClaudeStreamState): StreamChunk[] {
    state.stats.compactCount++;
    state.stats.lastCompactAt = Date.now();
    const record = asRecord(message) || {};
    const summary = stringValue(record, 'summary') || '';

    log.info(`Compaction #${state.stats.compactCount}: summary=${summary.slice(0, 120)}`);

    return [
      {
        type: 'compression:done',
        content: summary,
        data: {
          compactCount: state.stats.compactCount,
          summary
        }
      }
    ];
  }

  /** 后台任务启动通知 */
  private mapTaskStarted(message: SDKMessage, state: ClaudeStreamState): StreamChunk[] {
    state.stats.taskCount++;
    const record = asRecord(message) || {};
    const taskId = stringValue(record, 'task_id') || '';
    const description = stringValue(record, 'description') || '';

    return [
      {
        type: 'delegate:start',
        content: description,
        data: { taskId, description }
      }
    ];
  }

  /** 后台任务进度 */
  private mapTaskProgress(message: SDKMessage): StreamChunk[] {
    const record = asRecord(message) || {};
    const summary = stringValue(record, 'summary') || '';
    if (!summary) return [];
    return [{ type: 'tool:delta', content: summary, data: { delta: summary } }];
  }

  /** 后台任务完成/停止通知 */
  private mapTaskNotification(message: SDKMessage, _state: ClaudeStreamState): StreamChunk[] {
    const record = asRecord(message) || {};
    const status = stringValue(record, 'status') || '';

    return [
      {
        type: 'delegate:done',
        content: status === 'completed' ? 'Task completed' : `Task ${status}`,
        data: { status }
      }
    ];
  }

  /** 工具执行进度 */
  private mapToolProgress(message: SDKMessage): StreamChunk[] {
    const record = asRecord(message) || {};
    const toolName = stringValue(record, 'tool_name') || '';
    const progress = stringValue(record, 'progress') || '';
    if (!progress) return [];

    return [
      {
        type: 'tool:delta',
        content: progress,
        data: { toolName, delta: progress }
      }
    ];
  }

  /** Hook 事件（调试用） */
  private mapHookMessage(message: SDKMessage): StreamChunk[] {
    const record = asRecord(message) || {};
    const hookEvent = stringValue(record, 'hook_event') || '';
    const subtype = stringValue(record, 'subtype') || '';
    if (!hookEvent) return [];
    log.debug(`[hook] ${subtype}: ${hookEvent}`);
    return [];
  }

  /** 速率限制事件 */
  private mapRateLimit(
    message: Extract<SDKMessage, { type: 'rate_limit_event' }>,
    state: ClaudeStreamState
  ): StreamChunk[] {
    state.stats.rateLimitHits++;
    const record = asRecord(message) || {};
    const messageText = stringValue(record, 'message') || 'API rate limit hit';
    log.warn(`Rate limit #${state.stats.rateLimitHits}: ${messageText}`);
    return [{ type: 'run:error', content: messageText, data: { message: messageText } }];
  }

  /** 提示建议消息（暂存储用于后续功能） */
  private mapPromptSuggestion(message: SDKMessage): StreamChunk[] {
    const record = asRecord(message) || {};
    const suggestion = stringValue(record, 'suggestion') || '';
    if (suggestion) {
      log.debug(`[prompt-suggestion] ${suggestion.slice(0, 100)}`);
    }
    return [];
  }

  private mapStreamEvent(event: unknown, state: ClaudeStreamState): StreamChunk[] {
    const record = asRecord(event);
    if (!record) return [];

    const chunks: StreamChunk[] = [];
    const eventType = stringValue(record, 'type');
    const index = numberValue(record, 'index');

    if (eventType === 'content_block_start') {
      const block = asRecord(record.content_block);
      const blockType = block ? stringValue(block, 'type') : undefined;
      if (blockType === 'text') {
        this.pushTextStart(chunks, state);
      } else if (blockType === 'thinking') {
        this.pushReasoningStart(chunks, state);
      } else if (blockType === 'tool_use' && index !== undefined && block) {
        const toolName = stringValue(block, 'name') || 'tool';
        const toolId = stringValue(block, 'id') || `${toolName}-${index}`;
        const initialInput = recordValue(block, 'input');
        state.toolBlocks.set(index, {
          id: toolId,
          name: toolName,
          initialInput,
          inputJson: ''
        });
        chunks.push({
          type: 'tool:start',
          content: toolName,
          data: {
            toolName,
            callId: toolId,
            arguments: JSON.stringify(initialInput || {})
          }
        });
      }
      return chunks;
    }

    if (eventType === 'content_block_delta') {
      const delta = asRecord(record.delta);
      const deltaType = delta ? stringValue(delta, 'type') : undefined;

      if (deltaType === 'text_delta') {
        const text = delta ? stringValue(delta, 'text') || '' : '';
        if (text) {
          state.sawPartialText = true;
          state.fullOutput += text;
          this.pushTextStart(chunks, state);
          chunks.push({ type: 'text:delta', content: text, data: { delta: text } });
        }
      } else if (deltaType === 'thinking_delta') {
        const text = delta ? stringValue(delta, 'thinking') || '' : '';
        if (text) {
          state.fullReasoning += text;
          this.pushReasoningStart(chunks, state);
          chunks.push({ type: 'reasoning:delta', content: text, data: { delta: text } });
        }
      } else if (deltaType === 'input_json_delta' && index !== undefined) {
        const partialJson = delta ? stringValue(delta, 'partial_json') || '' : '';
        const tool = state.toolBlocks.get(index);
        if (tool && partialJson) {
          tool.inputJson += partialJson;
          chunks.push({
            type: 'tool:delta',
            content: partialJson,
            data: {
              toolName: tool.name,
              callId: tool.id,
              delta: partialJson
            }
          });
        }
      }
      return chunks;
    }

    if (eventType === 'content_block_stop' && index !== undefined) {
      const tool = state.toolBlocks.get(index);
      if (tool) {
        const args = parseToolArguments(tool);
        state.toolCalls.push({ toolName: tool.name, arguments: args });
        chunks.push({
          type: 'tool:done',
          content: tool.name,
          data: {
            toolName: tool.name,
            callId: tool.id,
            arguments: args
          }
        });
        state.toolBlocks.delete(index);
      }
    }

    return chunks;
  }

  private mapAssistantMessage(
    message: Extract<SDKMessage, { type: 'assistant' }>,
    state: ClaudeStreamState
  ): StreamChunk[] {
    const chunks: StreamChunk[] = [];
    if (message.error) {
      chunks.push({ type: 'run:error', content: message.error, data: { message: message.error } });
      return chunks;
    }

    if (state.sawPartialText) {
      return chunks;
    }

    const assistantMessage = asRecord(message.message);
    const content = assistantMessage?.content;
    if (!Array.isArray(content)) return chunks;

    for (const item of content) {
      const block = asRecord(item);
      if (!block) continue;
      const blockType = stringValue(block, 'type');
      if (blockType === 'text') {
        const text = stringValue(block, 'text') || '';
        if (text) {
          state.fullOutput += text;
          this.pushTextStart(chunks, state);
          chunks.push({ type: 'text:delta', content: text, data: { delta: text } });
        }
      } else if (blockType === 'tool_use') {
        const toolName = stringValue(block, 'name') || 'tool';
        const toolId = stringValue(block, 'id') || `${toolName}-${Date.now()}`;
        const args = recordValue(block, 'input') || {};
        chunks.push({
          type: 'tool:start',
          content: toolName,
          data: { toolName, callId: toolId, arguments: JSON.stringify(args) }
        });
        state.toolCalls.push({ toolName, arguments: args });
        chunks.push({
          type: 'tool:done',
          content: toolName,
          data: { toolName, callId: toolId, arguments: args }
        });
      }
    }

    return chunks;
  }

  private buildCompletionChunks(resultMessage: SDKResultMessage | null, state: ClaudeStreamState): StreamChunk[] {
    const chunks: StreamChunk[] = [];

    if (state.reasoningStarted && !state.reasoningDone) {
      state.reasoningDone = true;
      chunks.push({
        type: 'reasoning:done',
        content: '',
        data: { rawContent: state.fullReasoning }
      });
    }

    if (state.textStarted && !state.textDone) {
      state.textDone = true;
      chunks.push({
        type: 'text:done',
        content: '',
        data: { rawContent: state.fullOutput }
      });
    }

    chunks.push({
      type: 'llm:done',
      content: '',
      data: resultMessage ? this.extractUsage(resultMessage) : undefined
    });
    chunks.push({ type: 'turn:done', content: '' });

    if (resultMessage?.subtype === 'success') {
      chunks.push({ type: 'run:done', content: '' });
    } else {
      const message = this.getResultError(resultMessage);
      chunks.push({ type: 'run:error', content: message, data: { message } });
    }

    return chunks;
  }

  private buildResult(
    resultMessage: SDKResultMessage | null,
    state: ClaudeStreamState,
    startTime: number,
    sessionId: string,
    rawApiRequest: ExecutionResult['rawApiRequest']
  ): ExecutionResult {
    const output = resultMessage?.subtype === 'success' ? resultMessage.result || state.fullOutput : state.fullOutput;
    const error = resultMessage?.subtype === 'success' ? undefined : this.getResultError(resultMessage);

    // 从 SDKResultMessage 中提取 cost / usage / turns
    const costUsd = resultMessage?.total_cost_usd;
    const usage = resultMessage?.usage;
    const modelUsage = resultMessage?.modelUsage;
    const numTurns = resultMessage?.num_turns;
    const subtype = resultMessage?.subtype;
    const stopReason = resultMessage?.stop_reason;
    const terminalReason = resultMessage?.terminal_reason;
    const durationMs = Date.now() - startTime;

    // 汇总 usage（优先 modelUsage，再降级 usage）
    let totalTokens: number | undefined;
    if (modelUsage) {
      totalTokens = Number(modelUsage.inputTokens ?? 0) + Number(modelUsage.outputTokens ?? 0);
    } else if (usage) {
      totalTokens = (usage.input_tokens || 0) + (usage.output_tokens || 0);
    }

    return {
      output,
      ...(error ? { error } : {}),
      toolCalls: state.toolCalls,
      duration: durationMs,
      metadata: {
        sessionId,
        sdkSessionId: state.sdkSessionId,
        sdk: 'claude-agent-sdk',
        subtype,
        stopReason,
        terminalReason,
        numTurns,
        costUsd,
        totalTokens,
        usage: usage
          ? {
              inputTokens: usage.input_tokens,
              outputTokens: usage.output_tokens,
              cacheReadInputTokens: usage.cache_read_input_tokens,
              cacheCreationInputTokens: usage.cache_creation_input_tokens
            }
          : undefined,
        modelUsage: modelUsage
          ? {
              inputTokens: modelUsage.inputTokens,
              outputTokens: modelUsage.outputTokens,
              cacheReadInputTokens: modelUsage.cacheReadInputTokens,
              cacheCreationInputTokens: modelUsage.cacheCreationInputTokens,
              costUSD: modelUsage.costUSD
            }
          : undefined,
        // session 统计
        compactCount: state.stats.compactCount,
        taskCount: state.stats.taskCount,
        rateLimitHits: state.stats.rateLimitHits
      },
      rawApiRequest
    };
  }

  private buildRequestPreview(
    input: string,
    options: AgentRuntimeOptions,
    finalInstructions: string,
    sdkSessionId?: string
  ): ExecutionResult['rawApiRequest'] {
    return {
      source: 'runtime-synthesized-preview',
      sdk: 'claude-agent-sdk',
      model: options.model || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      messages: [
        { role: 'system', content: finalInstructions },
        { role: 'user', content: input }
      ],
      stream: true,
      max_turns: options.maxTurns,
      ...(sdkSessionId ? { sdkSessionId } : {}),
      permissionMode: 'acceptEdits'
    };
  }

  private createStreamState(sdkSessionId?: string): ClaudeStreamState {
    return {
      sdkSessionId,
      fullOutput: '',
      fullReasoning: '',
      sawPartialText: false,
      textStarted: false,
      textDone: false,
      reasoningStarted: false,
      reasoningDone: false,
      toolBlocks: new Map(),
      toolCalls: [],
      stats: { compactCount: 0, taskCount: 0, rateLimitHits: 0 }
    };
  }

  private pushTextStart(chunks: StreamChunk[], state: ClaudeStreamState): void {
    if (state.textStarted) return;
    state.textStarted = true;
    chunks.push({ type: 'text:start', content: '' });
  }

  private pushReasoningStart(chunks: StreamChunk[], state: ClaudeStreamState): void {
    if (state.reasoningStarted) return;
    state.reasoningStarted = true;
    chunks.push({ type: 'reasoning:start', content: '' });
  }

  private captureSdkSessionId(message: SDKMessage, state: ClaudeStreamState): void {
    const record = asRecord(message);
    const sdkSessionId = record ? stringValue(record, 'session_id') : undefined;
    if (sdkSessionId) {
      state.sdkSessionId = sdkSessionId;
    }
  }

  private getResultError(resultMessage: SDKResultMessage | null): string {
    if (!resultMessage) return 'Claude SDK did not return a result message';
    if (resultMessage.subtype === 'success') return '';
    return resultMessage.errors?.join('\n') || resultMessage.subtype;
  }

  private extractUsage(resultMessage: SDKResultMessage): Record<string, unknown> {
    return {
      usage: resultMessage.usage,
      modelUsage: resultMessage.modelUsage,
      totalCostUsd: resultMessage.total_cost_usd,
      durationMs: resultMessage.duration_ms,
      durationApiMs: resultMessage.duration_api_ms
    };
  }

  private mapThinkingLevel(level?: ThinkingLevel): Options['effort'] | undefined {
    switch (level) {
      case 'minimal':
      case 'low':
        return 'low';
      case 'medium':
        return 'medium';
      case 'high':
        return 'high';
      case 'xhigh':
        return 'xhigh';
      default:
        return undefined;
    }
  }

  private toStableUuid(input: string): string {
    const bytes = Buffer.from(createHash('sha256').update(input).digest().subarray(0, 16));
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}

function asRecord(value: unknown): UnknownRecord | undefined {
  if (!value || typeof value !== 'object') return undefined;
  return value as UnknownRecord;
}

function stringValue(record: UnknownRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function numberValue(record: UnknownRecord, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' ? value : undefined;
}

function recordValue(record: UnknownRecord, key: string): Record<string, unknown> | undefined {
  const value = asRecord(record[key]);
  return value ? { ...value } : undefined;
}

function parseToolArguments(tool: ToolBlockState): Record<string, unknown> {
  if (!tool.inputJson) return tool.initialInput || {};
  try {
    const parsed = JSON.parse(tool.inputJson);
    return asRecord(parsed) || {};
  } catch {
    return tool.initialInput || {};
  }
}

/** 匹配工具名是否命中策略模式（支持通配符 *） */
function matchToolPattern(toolName: string, pattern: string): boolean {
  if (pattern === '*' || pattern === toolName) return true;
  if (pattern.endsWith('*')) {
    return toolName.startsWith(pattern.slice(0, -1));
  }
  return false;
}
