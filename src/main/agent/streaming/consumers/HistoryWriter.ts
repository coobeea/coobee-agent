/**
 * 历史聚合写入器（消费者：生成 history.jsonl）
 * 
 * 监听 EventBus 的流式消息，实时聚合并写入前端友好的历史格式。
 * 
 * 聚合策略：
 * - 按 turn 聚合（一轮对话）
 * - 合并同一轮的 thinking + text + tools
 * - 生成统一的 AggregatedMessage 格式（运行时无关）
 */

import fs from 'node:fs';
import path from 'node:path';
import { eventBus } from '@main/common/eventbus';
import { createLogger } from '@main/common/logger';
import { StreamEventType, type StreamEvent, type StreamMessage } from '../types';

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

/**
 * 历史写入器
 */
export class HistoryWriter {
  private historyFiles = new Map<string, string>();
  private currentTurns = new Map<string, Partial<AggregatedMessage>>();
  private userMessages = new Map<string, string>(); // 暂存用户消息
  private workspacesDir: string;
  private initialized = false;

  constructor(workspacesDir: string) {
    this.workspacesDir = workspacesDir;
  }

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
  stop(): void {
    if (!this.initialized) return;

    eventBus.off(StreamEventType.MESSAGE, this.handleMessage);
    this.historyFiles.clear();
    this.currentTurns.clear();
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
    if (!this.historyFiles.has(sessionId)) {
      this.initializeSession(sessionId);
    }

    // 根据消息类型分发处理
    switch (message.type) {
      case 'run:start':
        // 执行开始，等待用户消息（从 context 或其他途径获取）
        break;

      case 'turn:start':
        this.startNewTurn(sessionId);
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

      case 'tool:done':
        this.updateTool(sessionId, message);
        break;

      case 'llm:done':
        this.updateMetadata(sessionId, message);
        break;

      case 'turn:done':
        this.finalizeTurn(sessionId);
        break;
    }
  };

  /**
   * 初始化会话
   */
  private initializeSession(sessionId: string): void {
    const workspacePath = path.join(this.workspacesDir, sessionId);
    const historyFile = path.join(workspacePath, 'history.jsonl');

    this.historyFiles.set(sessionId, historyFile);
    log.debug(`[HistoryWriter] Initialized session: ${sessionId}`);
  }

  /**
   * 开始新一轮 AI 响应
   */
  private startNewTurn(sessionId: string): void {
    const turn: Partial<AggregatedMessage> = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      timestamp: new Date().toISOString(),
      content: '',
      thinking: '',
      tools: [],
      metadata: {}
    };

    this.currentTurns.set(sessionId, turn);
  }

  /**
   * 追加思考内容
   */
  private appendThinking(sessionId: string, message: StreamMessage): void {
    const turn = this.currentTurns.get(sessionId);
    if (!turn) return;

    const delta = message.data?.delta as string;
    if (delta) {
      turn.thinking = (turn.thinking || '') + delta;
    }
  }

  /**
   * 追加文本内容
   */
  private appendText(sessionId: string, message: StreamMessage): void {
    const turn = this.currentTurns.get(sessionId);
    if (!turn) return;

    const delta = message.content;
    if (delta) {
      turn.content = (turn.content || '') + delta;
    }
  }

  /**
   * 添加工具调用
   */
  private addTool(sessionId: string, message: StreamMessage): void {
    const turn = this.currentTurns.get(sessionId);
    if (!turn || !turn.tools) return;

    const data = message.data as Record<string, unknown> | undefined;
    if (!data) return;

    turn.tools.push({
      name: (data.toolName as string) || 'unknown',
      callId: (data.callId as string) || '',
      arguments: data.arguments as Record<string, unknown> | undefined,
      status: 'calling'
    });
  }

  /**
   * 更新工具执行结果
   */
  private updateTool(sessionId: string, message: StreamMessage): void {
    const turn = this.currentTurns.get(sessionId);
    if (!turn || !turn.tools) return;

    const data = message.data as Record<string, unknown> | undefined;
    if (!data) return;

    const tool = turn.tools.find(t => t.callId === data.callId);
    if (tool) {
      tool.status = 'done';
      tool.result = (data.output as string) || '';
    }
  }

  /**
   * 更新元数据（token 统计等）
   */
  private updateMetadata(sessionId: string, message: StreamMessage): void {
    const turn = this.currentTurns.get(sessionId);
    if (!turn || !turn.metadata) return;

    const data = message.data as Record<string, unknown> | undefined;
    if (data?.usage) {
      const usage = data.usage as Record<string, unknown>;
      turn.metadata.tokens = {
        inputTokens: (usage.inputTokens as number) || 0,
        outputTokens: (usage.outputTokens as number) || 0,
        totalTokens: (usage.totalTokens as number) || 0
      };
    }
  }

  /**
   * 完成一轮，写入文件
   */
  private finalizeTurn(sessionId: string): void {
    const turn = this.currentTurns.get(sessionId);
    if (!turn) return;

    const historyFile = this.historyFiles.get(sessionId);
    if (!historyFile) return;

    try {
      // 确保目录存在
      const dir = path.dirname(historyFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 清理空字段
      if (!turn.thinking) delete turn.thinking;
      if (turn.tools?.length === 0) delete turn.tools;

      // 写入
      const line = JSON.stringify(turn);
      fs.appendFileSync(historyFile, line + '\n');

      log.debug(`[HistoryWriter] Wrote turn for session: ${sessionId}`);
    } catch (err) {
      log.warn(`[HistoryWriter] Write failed for session ${sessionId}:`, err);
    }

    // 清理当前 turn
    this.currentTurns.delete(sessionId);
  }

  /**
   * 写入用户消息（需要外部调用，因为用户消息不在 stream 中）
   */
  writeUserMessage(sessionId: string, content: string, timestamp?: string): void {
    const historyFile = this.historyFiles.get(sessionId);
    if (!historyFile) {
      this.initializeSession(sessionId);
    }

    const message: AggregatedMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      timestamp: timestamp || new Date().toISOString(),
      content
    };

    const file = this.historyFiles.get(sessionId)!;
    try {
      const dir = path.dirname(file);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const line = JSON.stringify(message);
      fs.appendFileSync(file, line + '\n');

      log.debug(`[HistoryWriter] Wrote user message for session: ${sessionId}`);
    } catch (err) {
      log.warn(`[HistoryWriter] Write user message failed:`, err);
    }
  }

  /**
   * 清理指定会话的缓存
   */
  clearSession(sessionId: string): void {
    this.historyFiles.delete(sessionId);
    this.currentTurns.delete(sessionId);
    this.userMessages.delete(sessionId);
  }
}
