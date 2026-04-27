/**
 * CompactionFileSession — 带自动压缩的 Session 装饰器
 *
 * 基于 OpenAIResponsesCompactionSession 装饰 FileSession，在对话历史增长时
 * 自动触发 SDK 内置的 responses.compact 压缩。
 *
 * 设计：
 *   - openai-compatible：OpenAIResponsesCompactionSession 装饰 FileSession
 *   - anthropic：直接使用 FileSession（OpenAI 的 compact API 不可用）
 *
 * 用法：
 *   const session = new CompactionFileSession(sessionId, sessionDir, {
 *     apiKey: '...',
 *     baseURL: '...',
 *     model: 'gpt-4o',
 *     apiType: 'openai-compatible',
 *   });
 *   // 直接传给 run(agent, input, { session })
 */

import OpenAI from 'openai';
import type { Session, AgentInputItem } from '@openai/agents';
import { OpenAIResponsesCompactionSession, setDefaultOpenAIClient } from '@openai/agents';
import type { OpenAIResponsesCompactionDecisionContext } from '@openai/agents';
import { FileSession } from './FileSession';
import type { SummaryMeta, SessionItem } from './types';

export interface CompactionFileSessionOptions {
  /** OpenAI / 兼容 API Key（压缩 API 调用用） */
  apiKey: string;
  /** OpenAI / 兼容 API Base URL */
  baseURL: string;
  /** 压缩用的模型名称 */
  model: string;
  /** 自定义触发条件（可选，默认 >= 10 条候选消息） */
  shouldTriggerCompaction?: (context: OpenAIResponsesCompactionDecisionContext) => boolean | Promise<boolean>;
}

/**
 * 带自动压缩的 FileSession
 *
 * implements Session 以兼容 SDK 的 run() 参数。
 */
export class CompactionFileSession implements Session {
  private readonly inner: Session;
  private readonly compactionSession: OpenAIResponsesCompactionSession;
  private readonly fileSession: FileSession;

  constructor(sessionId: string, sessionDir: string, options: CompactionFileSessionOptions) {
    this.fileSession = new FileSession(sessionId, sessionDir);

    // 设置默认客户端供压缩使用（不影响 Agent 模型配置）
    setDefaultOpenAIClient(
      new OpenAI({
        apiKey: options.apiKey,
        baseURL: options.baseURL
      })
    );

    this.compactionSession = new OpenAIResponsesCompactionSession({
      model: options.model as OpenAI.ResponsesModel,
      underlyingSession: this.fileSession,
      shouldTriggerCompaction: options.shouldTriggerCompaction
    });
    this.inner = this.compactionSession;
  }

  // ========== Session 接口（委托给 inner）==========

  async getSessionId(): Promise<string> {
    return this.inner.getSessionId();
  }

  async getItems(limit?: number): Promise<AgentInputItem[]> {
    return this.inner.getItems(limit);
  }

  async addItems(items: AgentInputItem[]): Promise<void> {
    return this.inner.addItems(items);
  }

  async popItem(): Promise<AgentInputItem | undefined> {
    return this.inner.popItem();
  }

  async clearSession(): Promise<void> {
    return this.inner.clearSession();
  }

  // ========== 扩展方法 ==========

  /** 手动触发一次压缩 */
  async runCompaction(force = false): Promise<unknown> {
    return this.compactionSession.runCompaction({ force });
  }

  /** 获取底层 FileSession（用于调试、快照等） */
  getFileSession(): FileSession {
    return this.fileSession;
  }

  /** 获取文件路径（调试用） */
  getFilePath(): string {
    return this.fileSession.getFilePath();
  }

  /** 获取消息数量 */
  async getItemCount(): Promise<number> {
    return this.fileSession.getItemCount();
  }

  /** 获取全部 SessionItem */
  async getAllSessionItems(): Promise<SessionItem[]> {
    return this.fileSession.getAllSessionItems();
  }

  /** 追加总结项 */
  async appendSummaryItem(meta: SummaryMeta): Promise<void> {
    return this.fileSession.appendSummaryItem(meta);
  }

  /** 获取最后一个总结 */
  async getLastSummary(): Promise<SummaryMeta | undefined> {
    return this.fileSession.getLastSummary();
  }
}
