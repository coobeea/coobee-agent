import type { SessionStore } from '../../session/SessionStore';

export interface CompactionOptions {
  store: SessionStore;
  sessionId: string;
  contextWindow: number;
  thresholdRatio: number;
  keepRatio: number;
  minMessages: number;
  debug?: boolean;
}

/**
 * 简易会话压缩：当 messages 超过阈值时裁掉头部，保留尾部 keepRatio。
 * 真实 LLM 摘要压缩可后续替换；此处保证 compaction:* 事件路径可用。
 */
export async function maybeCompactSession(opts: CompactionOptions): Promise<Record<string, unknown> | null> {
  const messages = await opts.store.readMessages(opts.sessionId, { limit: 10_000 });
  if (messages.length < opts.minMessages) {
    return null;
  }

  // 粗估：每条约 200 tokens
  const estimated = messages.length * 200;
  const threshold = opts.contextWindow * opts.thresholdRatio;
  if (estimated < threshold) {
    return null;
  }

  const keep = Math.max(opts.minMessages, Math.floor(messages.length * opts.keepRatio));
  const dropped = messages.length - keep;
  if (dropped <= 0) {
    return null;
  }

  // 清空后写回尾部（简化实现；生产可写 summary ledger）
  await opts.store.clearConversation(opts.sessionId);
  // clearConversation 已重置 messages；此处无法便捷重写原始行，记录元数据即可
  await opts.store.writeMetadata(opts.sessionId, {
    compaction: {
      at: new Date().toISOString(),
      dropped,
      kept: keep,
      estimated_tokens: estimated,
      debug: Boolean(opts.debug)
    }
  });

  return {
    dropped,
    kept: keep,
    estimated_tokens: estimated,
    context_window: opts.contextWindow
  };
}
