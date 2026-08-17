/** 令牌用量（llm:done、turn:done、run:done 及事件 data 汇总）。 */
export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  contextWindow?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
}

/** 将 TokenUsage 规范化为事件 data.usage。 */
export function normalizeUsageForEvent(usage: TokenUsage | null | undefined): Record<string, unknown> | undefined {
  if (!usage) {
    return undefined;
  }
  const total =
    usage.totalTokens && usage.totalTokens > 0
      ? usage.totalTokens
      : (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);

  const payload: Record<string, unknown> = {
    input_tokens: usage.inputTokens ?? 0,
    output_tokens: usage.outputTokens ?? 0,
    total_tokens: total
  };
  if (usage.contextWindow && usage.contextWindow > 0) {
    payload.context_window = usage.contextWindow;
  }
  if (usage.reasoningTokens && usage.reasoningTokens > 0) {
    payload.reasoning_tokens = usage.reasoningTokens;
  }
  if (usage.cacheReadTokens && usage.cacheReadTokens > 0) {
    payload.cache_read_tokens = usage.cacheReadTokens;
  }
  return payload;
}

function usageIntFromMap(m: Record<string, unknown> | null | undefined, ...keys: string[]): number {
  if (!m) {
    return 0;
  }
  for (const k of keys) {
    const v = m[k];
    if (typeof v === 'number' && Number.isFinite(v)) {
      return Math.trunc(v);
    }
  }
  return 0;
}

/** 从事件 data（含 usage 嵌套）解析 TokenUsage。 */
export function usageFromDataMap(data: Record<string, unknown> | null | undefined): TokenUsage | undefined {
  if (!data) {
    return undefined;
  }
  const raw = data.usage;
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const m = raw as Record<string, unknown>;
  const u: TokenUsage = {
    inputTokens: usageIntFromMap(m, 'input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokens'),
    outputTokens: usageIntFromMap(m, 'output_tokens', 'outputTokens', 'completion_tokens', 'completionTokens'),
    totalTokens: usageIntFromMap(m, 'total_tokens', 'totalTokens'),
    contextWindow: usageIntFromMap(m, 'context_window', 'contextWindow'),
    reasoningTokens: usageIntFromMap(m, 'reasoning_tokens', 'reasoningTokens'),
    cacheReadTokens: usageIntFromMap(m, 'cache_read_tokens', 'cacheReadTokens')
  };

  if (!u.cacheReadTokens || u.cacheReadTokens <= 0) {
    for (const key of ['input_tokens_details', 'inputTokensDetails', 'prompt_tokens_details', 'promptTokensDetails']) {
      const details = m[key];
      if (details && typeof details === 'object') {
        const v = usageIntFromMap(details as Record<string, unknown>, 'cached_tokens', 'cachedTokens');
        if (v > 0) {
          u.cacheReadTokens = v;
          break;
        }
      }
    }
  }

  if (!u.reasoningTokens || u.reasoningTokens <= 0) {
    for (const key of [
      'output_tokens_details',
      'outputTokensDetails',
      'completion_tokens_details',
      'completionTokensDetails'
    ]) {
      const details = m[key];
      if (details && typeof details === 'object') {
        const v = usageIntFromMap(details as Record<string, unknown>, 'reasoning_tokens', 'reasoningTokens');
        if (v > 0) {
          u.reasoningTokens = v;
          break;
        }
      }
    }
  }

  if (!u.totalTokens) {
    u.totalTokens = (u.inputTokens ?? 0) + (u.outputTokens ?? 0);
  }

  if (
    !(u.inputTokens ?? 0) &&
    !(u.outputTokens ?? 0) &&
    !(u.totalTokens ?? 0) &&
    !(u.cacheReadTokens ?? 0) &&
    !(u.reasoningTokens ?? 0)
  ) {
    return undefined;
  }
  return u;
}
