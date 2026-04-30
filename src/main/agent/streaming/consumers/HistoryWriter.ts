/**
 * 历史聚合写入器（消费者：生成 history.jsonl）
 *
 * 监听 EventBus 的流式消息，实时聚合并异步写入前端友好的历史格式。
 *
 * 聚合策略：
 * - 按 run 聚合（一次用户请求）
 * - run 内保留 turns[]，记录每次 LLM 调用、工具调用和 usage
 * - run:done 时写入一条 assistant v2 记录
 */

import path from 'node:path';
import { eventBus } from '@main/common/eventbus';
import { createLogger } from '@main/common/logger';
import { resolveThreadRuntimeLayoutSync } from '@main/agent/context/AgentRuntimeLayout';
import {
  StreamEventType,
  type HistoryAssistantMessageV2,
  type StreamEvent,
  type StreamMessage,
  type TurnRecord,
  type UsageRecord
} from '../types';
import { AsyncJsonlWriter } from './AsyncJsonlWriter';

const log = createLogger('history-writer');

/**
 * 聚合后的消息格式（前端友好）
 */
export interface AggregatedMessage {
  id: string;
  role: 'user' | 'assistant';
  timestamp: string;
  content: string;

  // assistant 专属字段
  thinking?: string;
  tools?: Array<{
    name: string;
    callId: string;
    arguments?: Record<string, unknown>;
    result?: string;
    status: 'calling' | 'done' | 'error';
  }>;

  // 元数据
  metadata?: {
    model?: string;
    duration?: number;
    tokens?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
  };
}

interface RunState {
  id: string;
  role: 'assistant';
  timestamp: string;
  startTime: string;
  status: 'running' | 'done' | 'error' | 'interrupted';
  turns: TurnRecord[];
  usage: UsageRecord;
  error?: string;
}

/**
 * 历史写入器
 */
export class HistoryWriter {
  private historyFiles = new Map<string, string>();
  // 当前事件协议没有稳定 runId；第一阶段同一 session 只维护一个 active run。
  // 如需支持同 session 并发 run，必须先在 run/turn/llm 全链路事件中补充真实 runId。
  private currentRuns = new Map<string, RunState>();
  private userMessages = new Map<string, string>(); // 暂存用户消息
  private writer = new AsyncJsonlWriter('HistoryWriter');
  private initialized = false;

  /**
   * 启动监听
   */
  start(): void {
    if (this.initialized) {
      log.warn('[HistoryWriter] Already initialized');
      return;
    }

    eventBus.on(StreamEventType.MESSAGE, this.handleMessage);
    this.initialized = true;
    log.info('[HistoryWriter] Started listening to stream messages');
  }

  /**
   * 停止监听
   */
  async stop(): Promise<void> {
    if (!this.initialized) return;

    eventBus.off(StreamEventType.MESSAGE, this.handleMessage);
    this.flushActiveRuns('interrupted');
    await this.writer.closeAll();
    this.historyFiles.clear();
    this.currentRuns.clear();
    this.userMessages.clear();
    this.initialized = false;
    log.info('[HistoryWriter] Stopped listening');
  }

  /**
   * 处理流式消息
   */
  private handleMessage = (event: StreamEvent): void => {
    if (!event.message) return;

    const { sessionId, message } = event;

    // 初始化会话
    if (!this.historyFiles.has(sessionId) && !this.initializeSession(sessionId, getAgentIdFromMessage(message))) {
      return;
    }

    // 根据消息类型分发处理
    switch (message.type) {
      case 'run:start':
        this.startRun(sessionId, message);
        break;

      case 'turn:start':
        this.startNewTurn(sessionId, message);
        break;

      case 'reasoning:delta':
        this.appendThinking(sessionId, message);
        break;

      case 'text:delta':
        this.appendText(sessionId, message);
        break;

      case 'tool:start':
        this.addTool(sessionId, message);
        break;

      case 'tool:delta':
        this.updateToolArguments(sessionId, message);
        break;

      case 'tool:pending':
        this.updateToolArguments(sessionId, message);
        break;

      case 'tool:done':
        this.updateTool(sessionId, message);
        break;

      case 'llm:done':
        this.updateUsage(sessionId, message);
        break;

      case 'turn:done':
        this.finalizeTurn(sessionId, message);
        break;

      case 'run:done':
        this.finalizeRun(sessionId, 'done', message);
        break;

      case 'run:error':
        this.finalizeRun(sessionId, 'error', message);
        break;
    }
  };

  /**
   * 初始化会话
   */
  private initializeSession(sessionId: string, agentId?: string): boolean {
    let historyFile: string;
    try {
      const layout = resolveThreadRuntimeLayoutSync(sessionId, agentId);
      historyFile = path.join(layout.sessionDir, 'history.jsonl');
    } catch (error) {
      log.error(`[HistoryWriter] Failed to resolve session path for ${sessionId}:`, error);
      return false;
    }

    this.historyFiles.set(sessionId, historyFile);
    log.debug(`[HistoryWriter] Initialized session: ${sessionId}`);
    return true;
  }

  /** 开始一次用户请求对应的 assistant 聚合记录 */
  private startRun(sessionId: string, message: StreamMessage): void {
    const existing = this.currentRuns.get(sessionId);
    if (existing) {
      this.finalizeRun(sessionId, 'interrupted', message);
    }

    const timestamp = toIso(message.timestamp);
    this.currentRuns.set(sessionId, {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      timestamp,
      startTime: timestamp,
      status: 'running',
      turns: [],
      usage: emptyUsage()
    });
  }

  /**
   * 开始新一轮 AI 响应
   */
  private startNewTurn(sessionId: string, message: StreamMessage): void {
    const run = this.ensureRun(sessionId, message);
    const data = message.data as Record<string, unknown> | undefined;
    const index = typeof data?.turnIndex === 'number' ? data.turnIndex : run.turns.length + 1;
    const timestamp = toIso(message.timestamp);

    run.turns.push({
      index,
      startTime: timestamp,
      status: 'running',
      reasoning: '',
      content: '',
      toolCalls: [],
      usage: emptyUsage()
    });
  }

  /**
   * 追加思考内容
   */
  private appendThinking(sessionId: string, message: StreamMessage): void {
    const turn = this.getCurrentTurn(sessionId);
    if (!turn) return;

    const delta = (message.data?.delta as string | undefined) || message.content;
    if (delta) {
      turn.reasoning += delta;
    }
  }

  /**
   * 追加文本内容
   */
  private appendText(sessionId: string, message: StreamMessage): void {
    const turn = this.getCurrentTurn(sessionId);
    if (!turn) return;

    const delta = message.content || (message.data?.delta as string | undefined);
    if (delta) {
      turn.content += delta;
    }
  }

  /**
   * 添加工具调用
   */
  private addTool(sessionId: string, message: StreamMessage): void {
    const turn = this.getCurrentTurn(sessionId);
    if (!turn) return;

    const data = message.data as Record<string, unknown> | undefined;
    if (!data) return;

    turn.toolCalls.push({
      name: (data.toolName as string) || 'unknown',
      callId: (data.callId as string) || '',
      arguments: data.arguments ?? data.toolArgs,
      status: 'calling',
      startTime: toIso(message.timestamp)
    });
  }

  /**
   * 更新工具参数。tool:pending 通常携带完整参数，tool:delta 在部分 runtime 中可能携带参数片段。
   */
  private updateToolArguments(sessionId: string, message: StreamMessage): void {
    const turn = this.getCurrentTurn(sessionId);
    if (!turn) return;

    const data = message.data as Record<string, unknown> | undefined;
    if (!data) return;

    const tool = this.findTool(turn, data);
    if (!tool) return;

    const args = data.arguments ?? data.toolArgs;
    if (args !== undefined) {
      tool.arguments = args;
      return;
    }

    if (message.type === 'tool:delta' && typeof data.delta === 'string' && tool.arguments === undefined) {
      tool.arguments = data.delta;
    }
  }

  /**
   * 更新工具执行结果
   */
  private updateTool(sessionId: string, message: StreamMessage): void {
    const turn = this.getCurrentTurn(sessionId);
    if (!turn) return;

    const data = message.data as Record<string, unknown> | undefined;
    if (!data) return;

    const tool = this.findTool(turn, data);
    if (tool) {
      tool.status = 'done';
      if (tool.arguments === undefined) {
        tool.arguments = data.arguments ?? data.toolArgs;
      }
      tool.result = (data.output as string) || message.content || '';
      tool.endTime = toIso(message.timestamp);
    }
  }

  /**
   * 更新元数据（token 统计等）
   */
  private updateUsage(sessionId: string, message: StreamMessage): void {
    const run = this.currentRuns.get(sessionId);
    const turn = this.getCurrentTurn(sessionId);
    if (!run || !turn) return;

    const data = message.data as Record<string, unknown> | undefined;
    if (data?.usage) {
      const usage = data.usage as Record<string, unknown>;
      const delta = {
        inputTokens: (usage.inputTokens as number) || 0,
        outputTokens: (usage.outputTokens as number) || 0,
        totalTokens: (usage.totalTokens as number) || 0,
        contextWindow: (usage.contextWindow as number | undefined) || undefined
      };
      addUsage(turn.usage, delta);
      addUsage(run.usage, delta);
    }
  }

  /**
   * 完成一轮，只更新内存状态，不写入文件
   */
  private finalizeTurn(sessionId: string, message: StreamMessage): void {
    const turn = this.getCurrentTurn(sessionId);
    if (!turn) return;

    turn.status = 'done';
    turn.endTime = toIso(message.timestamp);
  }

  /** 完成当前 run 并写入 history.jsonl */
  private finalizeRun(sessionId: string, status: 'done' | 'error' | 'interrupted', message?: StreamMessage): void {
    const run = this.currentRuns.get(sessionId);
    if (!run) return;

    const historyFile = this.historyFiles.get(sessionId);
    if (!historyFile) return;

    const endTime = toIso(message?.timestamp);
    const currentTurn = run.turns.at(-1);
    if (currentTurn && currentTurn.status === 'running') {
      currentTurn.status = status === 'done' ? 'done' : status;
      currentTurn.endTime = endTime;
    }

    run.status = status;
    if (status === 'error') {
      run.error = message?.content || (message?.data?.message as string | undefined) || '执行出错';
    }

    const content = run.turns.map((turn) => turn.content).join('');
    const hasReasoning = run.turns.some((turn) => turn.reasoning);

    if (!content && !hasReasoning && run.turns.length === 0 && status !== 'error') {
      this.currentRuns.delete(sessionId);
      return;
    }

    const assistantMessage: HistoryAssistantMessageV2 = {
      version: 2,
      id: run.id,
      role: 'assistant',
      timestamp: run.timestamp,
      startTime: run.startTime,
      endTime,
      status,
      content,
      turns: run.turns,
      usage: run.usage
    };

    if (run.error) {
      assistantMessage.error = run.error;
    }

    try {
      // 异步批量写入
      const line = JSON.stringify(assistantMessage);
      this.writer.writeLine(historyFile, line);

      log.debug(`[HistoryWriter] Queued run for session: ${sessionId}`);
    } catch (err) {
      log.warn(`[HistoryWriter] Enqueue failed for session ${sessionId}:`, err);
    }

    this.currentRuns.delete(sessionId);
  }

  /**
   * 写入用户消息（需要外部调用，因为用户消息不在 stream 中）
   */
  writeUserMessage(sessionId: string, content: string, timestamp?: string, agentId?: string): void {
    const historyFile = this.historyFiles.get(sessionId);
    if (!historyFile) {
      if (!this.initializeSession(sessionId, agentId)) return;
    }

    const message: AggregatedMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      timestamp: timestamp || new Date().toISOString(),
      content
    };

    const file = this.historyFiles.get(sessionId)!;
    try {
      const line = JSON.stringify(message);
      this.writer.writeLine(file, line);

      log.debug(`[HistoryWriter] Queued user message for session: ${sessionId}`);
    } catch (err) {
      log.warn(`[HistoryWriter] Enqueue user message failed:`, err);
    }
  }

  /**
   * 清理指定会话的缓存
   */
  async clearSession(sessionId: string): Promise<void> {
    const historyFile = this.historyFiles.get(sessionId);
    if (historyFile) {
      this.finalizeRun(sessionId, 'interrupted');
      await this.writer.closeFile(historyFile);
    }
    this.historyFiles.delete(sessionId);
    this.currentRuns.delete(sessionId);
    this.userMessages.delete(sessionId);
  }

  /** 强制 flush（测试和退出流程使用） */
  async flush(): Promise<void> {
    await this.writer.flush();
  }

  private ensureRun(sessionId: string, message: StreamMessage): RunState {
    let run = this.currentRuns.get(sessionId);
    if (!run) {
      this.startRun(sessionId, message);
      run = this.currentRuns.get(sessionId)!;
    }
    return run;
  }

  private getCurrentTurn(sessionId: string): TurnRecord | undefined {
    return this.currentRuns.get(sessionId)?.turns.at(-1);
  }

  private findTool(turn: TurnRecord, data: Record<string, unknown>): TurnRecord['toolCalls'][number] | undefined {
    const callId = data.callId;
    if (typeof callId === 'string' && callId) {
      const byCallId = turn.toolCalls.find((tool) => tool.callId === callId);
      if (byCallId) return byCallId;
    }

    const toolName = data.toolName;
    if (typeof toolName === 'string' && toolName) {
      const byName = [...turn.toolCalls].reverse().find((tool) => tool.name === toolName && tool.status === 'calling');
      if (byName) return byName;
    }

    return turn.toolCalls.at(-1);
  }

  private flushActiveRuns(status: 'interrupted'): void {
    for (const sessionId of Array.from(this.currentRuns.keys())) {
      this.finalizeRun(sessionId, status);
    }
  }
}

function getAgentIdFromMessage(message: StreamMessage): string | undefined {
  return message.source?.type === 'agent' ? message.source.id : undefined;
}

function emptyUsage(): UsageRecord {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0
  };
}

function addUsage(target: UsageRecord, delta: UsageRecord): void {
  target.inputTokens += delta.inputTokens;
  target.outputTokens += delta.outputTokens;
  target.totalTokens += delta.totalTokens;
  if (delta.contextWindow !== undefined) {
    target.contextWindow = delta.contextWindow;
  }
}

function toIso(timestamp?: number): string {
  return new Date(timestamp || Date.now()).toISOString();
}
