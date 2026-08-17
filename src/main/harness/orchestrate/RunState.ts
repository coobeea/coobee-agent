import type { TokenUsage } from '../types/TokenUsage';
import { usageFromDataMap } from '../types/TokenUsage';

/** 单轮编排过程状态。 */
export class RunState {
  assistantText = '';
  pendingTools = 0;
  turnIndex = -1;
  usage: TokenUsage = {};
  cancelled = false;
  failed: Error | null = null;
  blockedReason: string | null = null;
  shortReply: string | null = null;

  applyStreamEvent(type: string, content?: string, data?: Record<string, unknown>): void {
    if (type === 'text:delta' || type === 'text:done') {
      if (type === 'text:delta' && content) {
        this.assistantText += content;
      } else if (type === 'text:done' && content) {
        this.assistantText = content;
      }
    }
    if (type === 'tool:start') {
      this.pendingTools += 1;
    }
    if (type === 'tool:done') {
      this.pendingTools = Math.max(0, this.pendingTools - 1);
    }
    if (type === 'turn:start') {
      const idx = data?.turn_index;
      if (typeof idx === 'number') this.turnIndex = idx;
      else this.turnIndex += 1;
    }
    const usage = usageFromDataMap(data ?? null);
    if (usage) {
      this.usage = {
        inputTokens: (this.usage.inputTokens ?? 0) + (usage.inputTokens ?? 0),
        outputTokens: (this.usage.outputTokens ?? 0) + (usage.outputTokens ?? 0),
        totalTokens: (this.usage.totalTokens ?? 0) + (usage.totalTokens ?? 0),
        contextWindow: usage.contextWindow ?? this.usage.contextWindow,
        reasoningTokens: (this.usage.reasoningTokens ?? 0) + (usage.reasoningTokens ?? 0),
        cacheReadTokens: (this.usage.cacheReadTokens ?? 0) + (usage.cacheReadTokens ?? 0)
      };
    }
  }
}
