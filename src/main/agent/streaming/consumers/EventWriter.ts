/**
 * 事件文件写入器（消费者：持久化 events.jsonl）
 *
 * 监听 EventBus 的流式消息，异步批量写入 events.jsonl 文件。
 *
 * 设计原则：
 * - 通过监听 eventBus 实现，与核心流程解耦
 * - 单一职责：只负责写入 events.jsonl
 * - 自动管理文件路径和序列号
 */

import path from 'node:path';
import { eventBus } from '@main/common/eventbus';
import { createLogger } from '@main/common/logger';
import { resolveThreadRuntimeLayoutSync } from '@main/agent/context/AgentRuntimeLayout';
import { StreamEventType, type StreamEvent, type StreamMessage } from '../types';
import { AsyncJsonlWriter } from './AsyncJsonlWriter';

const log = createLogger('event-writer');

/**
 * 事件写入器
 */
export class EventWriter {
  private eventsFiles = new Map<string, string>();
  private sequences = new Map<string, number>();
  private writer = new AsyncJsonlWriter('EventWriter');
  private initialized = false;

  /**
   * 启动监听
   */
  start(): void {
    if (this.initialized) {
      log.warn('[EventWriter] Already initialized');
      return;
    }

    eventBus.on(StreamEventType.MESSAGE, this.handleMessage);
    this.initialized = true;
    log.info('[EventWriter] Started listening to stream messages');
  }

  /**
   * 停止监听（清理资源）
   */
  async stop(): Promise<void> {
    if (!this.initialized) return;

    eventBus.off(StreamEventType.MESSAGE, this.handleMessage);
    await this.writer.closeAll();
    this.eventsFiles.clear();
    this.sequences.clear();
    this.initialized = false;
    log.info('[EventWriter] Stopped listening');
  }

  /**
   * 处理流式消息
   */
  private handleMessage = (event: StreamEvent): void => {
    if (!event.message) return;

    const { sessionId, message } = event;

    // 获取或创建文件路径
    if (!this.eventsFiles.has(sessionId) && !this.initializeSession(sessionId, getAgentIdFromMessage(message))) {
      return;
    }

    // 分配序列号并写入
    const seq = this.getNextSequence(sessionId);
    this.writeEvent(sessionId, message, seq);
  };

  /**
   * 初始化会话（创建文件路径）
   */
  private initializeSession(sessionId: string, agentId?: string): boolean {
    let eventsFile: string;
    try {
      const layout = resolveThreadRuntimeLayoutSync(sessionId, agentId);
      eventsFile = path.join(layout.sessionDir, 'events.jsonl');
    } catch (error) {
      log.error(`[EventWriter] Failed to resolve session path for ${sessionId}:`, error);
      return false;
    }

    this.eventsFiles.set(sessionId, eventsFile);
    this.sequences.set(sessionId, 0);

    log.debug(`[EventWriter] Initialized session: ${sessionId}`);
    return true;
  }

  /**
   * 获取下一个序列号
   */
  private getNextSequence(sessionId: string): number {
    const current = this.sequences.get(sessionId) || 0;
    const next = current + 1;
    this.sequences.set(sessionId, next);
    return next;
  }

  /**
   * 写入事件到文件
   */
  private writeEvent(sessionId: string, message: StreamMessage, seq: number): void {
    const eventsFile = this.eventsFiles.get(sessionId);
    if (!eventsFile) return;

    try {
      // 构造事件行
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        seq,
        type: message.type,
        content: message.content,
        ...(message.data ? { data: message.data } : {})
      });

      // 异步批量追加写入
      this.writer.writeLine(eventsFile, line);
    } catch (err) {
      log.warn(`[EventWriter] Enqueue failed for session ${sessionId}:`, err);
    }
  }

  /**
   * 清理指定会话的缓存
   */
  async clearSession(sessionId: string): Promise<void> {
    const eventsFile = this.eventsFiles.get(sessionId);
    if (eventsFile) {
      await this.writer.closeFile(eventsFile);
    }
    this.eventsFiles.delete(sessionId);
    this.sequences.delete(sessionId);
  }

  /** 强制 flush（测试和退出流程使用） */
  async flush(): Promise<void> {
    await this.writer.flush();
  }
}

function getAgentIdFromMessage(message: StreamMessage): string | undefined {
  return message.source?.type === 'agent' ? message.source.id : undefined;
}
