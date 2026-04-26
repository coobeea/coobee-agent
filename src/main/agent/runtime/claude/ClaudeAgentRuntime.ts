/**
 * Claude Agent 运行时
 *
 * 基于 @anthropic-ai/claude-agent-sdk 接入 Claude Code 能力，并统一翻译为
 * Runtime 层的 StreamChunk / ExecutionResult 协议。
 */

import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { Options, Query, SDKMessage, SDKResultMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

import { AbstractAgentRuntime, createRuntimeLogger } from '../AbstractAgentRuntime';
import {
  buildInstructions,
  type AgentRuntimeOptions,
  type ExecutionResult,
  type StreamChunk,
  type ThinkingLevel
} from '../types';

const DEFAULT_MAX_TURNS = 25;
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

const log = createRuntimeLogger('claude-runtime');

type UnknownRecord = Record<string, unknown>;

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

    return {
      model: options.model || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      maxTurns: options.maxTurns ?? DEFAULT_MAX_TURNS,
      cwd,
      abortController: controller,
      env: this.buildClaudeEnv(options),
      includePartialMessages: true,
      promptSuggestions: false,
      permissionMode: 'acceptEdits',
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
      ...(sdkSessionId ? { sessionId: sdkSessionId } : {})
    };
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

  private mapSdkMessage(message: SDKMessage, state: ClaudeStreamState): StreamChunk[] {
    this.captureSdkSessionId(message, state);

    if (message.type === 'stream_event') {
      return this.mapStreamEvent(message.event, state);
    }

    if (message.type === 'assistant') {
      return this.mapAssistantMessage(message, state);
    }

    if (message.type === 'system' && message.subtype === 'init') {
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

    if (message.type === 'auth_status' && message.error) {
      return [{ type: 'run:error', content: message.error, data: { message: message.error } }];
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

  private mapAssistantMessage(message: Extract<SDKMessage, { type: 'assistant' }>, state: ClaudeStreamState): StreamChunk[] {
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

    return {
      output,
      ...(error ? { error } : {}),
      toolCalls: state.toolCalls,
      duration: Date.now() - startTime,
      metadata: {
        sessionId,
        sdkSessionId: state.sdkSessionId,
        sdk: 'claude-agent-sdk',
        ...(resultMessage
          ? {
              subtype: resultMessage.subtype,
              stopReason: resultMessage.stop_reason,
              terminalReason: resultMessage.terminal_reason,
              numTurns: resultMessage.num_turns,
              totalCostUsd: resultMessage.total_cost_usd,
              usage: resultMessage.usage,
              modelUsage: resultMessage.modelUsage
            }
          : {})
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
      max_turns: options.maxTurns ?? DEFAULT_MAX_TURNS,
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
      toolCalls: []
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
