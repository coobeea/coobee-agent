/**
 * 事件文件写入器（消费者：持久化 events.jsonl）
 * 
 * 监听 EventBus 的流式消息，写入 events.jsonl 文件。
 * 
 * 设计原则：
 * - 通过监听 eventBus 实现，与核心流程解耦
 * - 单一职责：只负责写入 events.jsonl
 * - 自动管理文件路径和序列号
 */

import fs from 'node:fs';
import path from 'node:path';
import { eventBus } from '@main/common/eventbus';
import { createLogger } from '@main/common/logger';
import { StreamEventType, type StreamEvent, type StreamMessage } from '../types';

const log = createLogger('event-writer');

/**
 * 事件写入器
 */
export class EventWriter {
  private eventsFiles = new Map<string, string>();
  private sequences = new Map<string, number>();
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
  stop(): void {
    if (!this.initialized) return;

    eventBus.off(StreamEventType.MESSAGE, this.handleMessage);
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
    if (!this.eventsFiles.has(sessionId)) {
      this.initializeSession(sessionId);
    }

    // 分配序列号并写入
    const seq = this.getNextSequence(sessionId);
    this.writeEvent(sessionId, message, seq);
  };

  /**
   * 初始化会话（创建文件路径）
   */
  private initializeSession(sessionId: string): void {
    const workspacePath = path.join(this.workspacesDir, sessionId);
    const eventsFile = path.join(workspacePath, 'events', 'events.jsonl');

    this.eventsFiles.set(sessionId, eventsFile);
    this.sequences.set(sessionId, 0);

    log.debug(`[EventWriter] Initialized session: ${sessionId}`);
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
      // 确保目录存在
      const dir = path.dirname(eventsFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 构造事件行
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        seq,
        type: message.type,
        content: message.content,
        ...(message.data ? { data: message.data } : {})
      });

      // 追加写入
      fs.appendFileSync(eventsFile, line + '\n');
    } catch (err) {
      log.warn(`[EventWriter] Write failed for session ${sessionId}:`, err);
    }
  }

  /**
   * 清理指定会话的缓存
   */
  clearSession(sessionId: string): void {
    this.eventsFiles.delete(sessionId);
    this.sequences.delete(sessionId);
  }
}
