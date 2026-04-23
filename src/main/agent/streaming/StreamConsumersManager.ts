/**
 * 流式消费者管理器
 *
 * 在系统启动时初始化所有监听器，统一管理其生命周期。
 */

import { createLogger } from '@main/common/logger';
import { StreamMonitor } from './consumers/StreamMonitor';
import { EventWriter } from './consumers/EventWriter';
import { HistoryWriter } from './consumers/HistoryWriter';

const log = createLogger('stream-consumers');

/**
 * 流式消费者管理器
 */
export class StreamConsumersManager {
  private streamMonitor: StreamMonitor | null = null;
  private eventWriter: EventWriter | null = null;
  private historyWriter: HistoryWriter | null = null;
  private initialized = false;

  /**
   * 初始化所有消费者
   *
   * @param workspacesDir - workspaces 根目录路径
   */
  init(workspacesDir: string): void {
    if (this.initialized) {
      log.warn('[StreamConsumersManager] Already initialized');
      return;
    }

    try {
      // 1. 启动统计监听器
      this.streamMonitor = new StreamMonitor();
      this.streamMonitor.start();
      log.info('[StreamConsumersManager] StreamMonitor started');

      // 2. 启动事件写入器
      this.eventWriter = new EventWriter(workspacesDir);
      this.eventWriter.start();
      log.info('[StreamConsumersManager] EventWriter started');

      // 3. 启动历史聚合写入器
      this.historyWriter = new HistoryWriter(workspacesDir);
      this.historyWriter.start();
      log.info('[StreamConsumersManager] HistoryWriter started');

      this.initialized = true;
      log.info('[StreamConsumersManager] All stream consumers initialized successfully');
    } catch (err) {
      log.error('[StreamConsumersManager] Initialization failed:', err);
      throw err;
    }
  }

  /**
   * 清理所有消费者资源
   */
  async destroy(): Promise<void> {
    if (!this.initialized) return;

    try {
      this.streamMonitor?.stop();
      await this.eventWriter?.stop();
      await this.historyWriter?.stop();

      this.streamMonitor = null;
      this.eventWriter = null;
      this.historyWriter = null;

      this.initialized = false;
      log.info('[StreamConsumersManager] All consumers stopped and destroyed');
    } catch (err) {
      log.error('[StreamConsumersManager] Destroy failed:', err);
    }
  }

  /**
   * 写入用户消息到历史文件
   *
   * 用户消息不在 stream 事件流中，需要手动写入
   *
   * @param sessionId - 会话 ID
   * @param content - 用户消息内容
   * @param timestamp - 时间戳（可选，默认当前时间）
   */
  writeUserMessage(sessionId: string, content: string, timestamp?: string): void {
    if (!this.initialized) {
      log.warn('[StreamConsumersManager] Not initialized, cannot write user message');
      return;
    }

    try {
      this.historyWriter?.writeUserMessage(sessionId, content, timestamp);
    } catch (err) {
      log.error(`[StreamConsumersManager] Failed to write user message for session ${sessionId}:`, err);
    }
  }

  /**
   * 清理指定会话的缓存
   *
   * @param sessionId - 会话 ID
   */
  async clearSession(sessionId: string): Promise<void> {
    await this.eventWriter?.clearSession(sessionId);
    await this.historyWriter?.clearSession(sessionId);
  }

  /**
   * 强制 flush 所有待写入事件
   */
  async flush(): Promise<void> {
    await this.eventWriter?.flush();
    await this.historyWriter?.flush();
  }

  /**
   * 获取历史写入器（供外部访问）
   */
  getHistoryWriter(): HistoryWriter | null {
    return this.historyWriter;
  }

  /**
   * 获取事件写入器（供外部访问）
   */
  getEventWriter(): EventWriter | null {
    return this.eventWriter;
  }

  /**
   * 获取统计监听器（供外部访问）
   */
  getStreamMonitor(): StreamMonitor | null {
    return this.streamMonitor;
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// 全局单例
export const streamConsumersManager = new StreamConsumersManager();
