/**
 * CompressedFileSession — FileSession + SessionCompressor 的组合 Session
 *
 * 实现 Session 和 OpenAIResponsesCompactionAwareSession 接口。
 * SDK runner 在每轮 turn 完成后自动调用 runCompaction()，
 * 我们在其中委托 SessionCompressor 执行自定义压缩逻辑。
 *
 * 与 OpenAIResponsesCompactionSession 的区别：
 *   - OpenAIResponsesCompactionSession：调用 OpenAI responses.compact API
 *   - CompressedFileSession：用 SessionCompressor 自定义 Token 阈值、分段保留、增量总结
 *
 * 用法：
 *   const model = buildModel(runtimeOptions);
 *   const session = new CompressedFileSession(sessionId, sessionDir, {
 *     model,
 *     compression: { thresholdRatio: 0.7, keepRatio: 0.3 }
 *   });
 *   await run(agent, input, { session });
 */

import type { Session, AgentInputItem, Model } from '@openai/agents';
import type {
  OpenAIResponsesCompactionAwareSession,
  OpenAIResponsesCompactionArgs,
  OpenAIResponsesCompactionResult,
} from '@openai/agents';
import { RequestUsage } from '@openai/agents';
import { FileSession } from './FileSession';
import { SessionCompressor } from './SessionCompressor';
import type { SessionCompressionOptions, SummaryMeta, SessionItem } from './types';

export interface CompressedFileSessionOptions {
  /** 压缩用的 Model 对象（已内置 apiKey/baseURL） */
  model: Model;
  /** 压缩配置（默认 enabled=true） */
  compression?: SessionCompressionOptions;
}

export class CompressedFileSession implements Session, OpenAIResponsesCompactionAwareSession {
  private readonly fileSession: FileSession;
  private readonly compressor: SessionCompressor;
  private readonly model: Model;

  constructor(sessionId: string, sessionDir: string, options: CompressedFileSessionOptions) {
    this.fileSession = new FileSession(sessionId, sessionDir);
    this.model = options.model;
    this.compressor = new SessionCompressor({
      enabled: true,
      ...options.compression,
    });
  }

  // ========== Session 接口（委托给 FileSession） ==========

  async getSessionId(): Promise<string> {
    return this.fileSession.getSessionId();
  }

  async getItems(limit?: number): Promise<AgentInputItem[]> {
    return this.fileSession.getItems(limit);
  }

  async addItems(items: AgentInputItem[]): Promise<void> {
    return this.fileSession.addItems(items);
  }

  async popItem(): Promise<AgentInputItem | undefined> {
    return this.fileSession.popItem();
  }

  async clearSession(): Promise<void> {
    return this.fileSession.clearSession();
  }

  // ========== OpenAIResponsesCompactionAwareSession ==========

  /**
   * SDK runner 在每轮 turn 完成后自动调用。
   * 我们委托 SessionCompressor 检查是否需要压缩并执行。
   */
  async runCompaction(_args?: OpenAIResponsesCompactionArgs): Promise<OpenAIResponsesCompactionResult | null> {
    const result = await this.compressor.compressIfNeeded(this.fileSession, this.model);
    if (result.compressed && result.originalTokens != null && result.summaryTokens != null) {
      return {
        usage: new RequestUsage({
          input_tokens: result.originalTokens,
          output_tokens: result.summaryTokens,
        }),
      };
    }
    return null;
  }

  // ========== 扩展方法 ==========

  async getAllSessionItems(): Promise<SessionItem[]> {
    return this.fileSession.getAllSessionItems();
  }

  async getLastSummary(): Promise<SummaryMeta | undefined> {
    return this.fileSession.getLastSummary();
  }

  getFilePath(): string {
    return this.fileSession.getFilePath();
  }

  async getItemCount(): Promise<number> {
    return this.fileSession.getItemCount();
  }
}
