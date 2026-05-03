import { ThreadlessExecutor } from '@main/agent/ThreadlessExecutor';
import type { AnalysisDimension, AnalysisResult, AnalysisTemplate, DimensionValue, InsightSession } from '@shared/types/insight';

const ANALYZER_INSTRUCTIONS = [
  '你是一个结构化洞察分析器。',
  '你必须只输出 JSON，不要输出解释、Markdown 或额外文字。',
  'JSON 格式必须为：{"summary": string, "confidence": number, "dimensions": Record<string, unknown>}',
  'dimensions 的 key 必须和输入模板里的 key 保持一致。',
  'score 维度输出 0-100 的数字。',
  'boolean 维度输出 true 或 false。',
  'list/tags 维度输出字符串数组。',
  'enum 维度优先从 options 中选择最接近的一项。'
].join('\n');

export interface InsightAnalyzeResult {
  result: AnalysisResult;
  usedFallback: boolean;
}

export class InsightAnalyzer {
  async analyze(session: InsightSession, template: AnalysisTemplate, newText: string): Promise<InsightAnalyzeResult> {
    const prompt = buildPrompt(session, template, newText);

    try {
      const raw = await ThreadlessExecutor.runMessage({
        agentId: session.config?.agentId || 'app-copilot',
        message: prompt,
        instructions: ANALYZER_INSTRUCTIONS,
        lightweight: true,
        maxTurns: 1,
        mode: 'chat'
      });

      const parsed = parseJsonPayload(raw);
      const result = normalizeAnalysisResult(parsed, template, session.transcript);
      return {
        result,
        usedFallback: false
      };
    } catch {
      return {
        result: buildFallbackResult(template, session.transcript, newText),
        usedFallback: true
      };
    }
  }
}

function buildPrompt(session: InsightSession, template: AnalysisTemplate, newText: string): string {
  const dimensionSpec = template.dimensions
    .map((dimension) => {
      const options = dimension.options?.length ? `；候选项：${dimension.options.join(' / ')}` : '';
      return `- ${dimension.key} | ${dimension.label} | ${dimension.type} | ${dimension.prompt}${options}`;
    })
    .join('\n');

  return [
    `模板名称：${template.name}`,
    `模板描述：${template.description}`,
    `分析目标：${template.analysisPrompt}`,
    `会话 ID：${session.id}`,
    '',
    '维度定义：',
    dimensionSpec,
    '',
    '新增文本：',
    newText || '（本次无新增文本，基于全量文本重新分析）',
    '',
    '全量文本：',
    session.transcript || '（空）'
  ].join('\n');
}

function parseJsonPayload(raw: string): unknown {
  const text = raw.trim();
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = codeBlockMatch?.[1]?.trim() || text;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  const jsonText = firstBrace >= 0 && lastBrace > firstBrace ? candidate.slice(firstBrace, lastBrace + 1) : candidate;
  return JSON.parse(jsonText);
}

function normalizeAnalysisResult(payload: unknown, template: AnalysisTemplate, transcript: string): AnalysisResult {
  const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  const dimensionsInput =
    typeof record.dimensions === 'object' && record.dimensions !== null ? (record.dimensions as Record<string, unknown>) : {};

  const dimensions = template.dimensions.reduce<Record<string, DimensionValue>>((acc, dimension) => {
    const rawValue = dimensionsInput[dimension.key];
    acc[dimension.key] = {
      key: dimension.key,
      label: dimension.label,
      type: dimension.type,
      value: normalizeDimensionValue(dimension, rawValue, transcript),
      rawText: typeof rawValue === 'string' ? rawValue : undefined
    };
    return acc;
  }, {});

  return {
    dimensions,
    summary: typeof record.summary === 'string' ? record.summary : summarizeTranscript(transcript),
    confidence: normalizeConfidence(record.confidence)
  };
}

function normalizeDimensionValue(dimension: AnalysisDimension, value: unknown, transcript: string): unknown {
  switch (dimension.type) {
    case 'score':
    case 'progress': {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, Math.min(100, Math.round(value)));
      }
      return estimateScore(transcript);
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : detectBoolean(transcript);
    case 'list':
    case 'tags':
      return normalizeStringArray(value, transcript, dimension.maxItems);
    case 'enum':
      return normalizeEnum(value, dimension);
    case 'comparison':
      return typeof value === 'string' ? value : summarizeTranscript(transcript);
    case 'text':
    default:
      return typeof value === 'string' && value.trim() ? value.trim() : summarizeTranscript(transcript);
  }
}

function normalizeConfidence(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }
  return 0.6;
}

function normalizeEnum(value: unknown, dimension: AnalysisDimension): string {
  if (typeof value === 'string' && value.trim()) {
    const normalized = value.trim();
    if (!dimension.options?.length) {
      return normalized;
    }
    const matched = dimension.options.find((option) => option === normalized);
    if (matched) {
      return matched;
    }
  }
  return dimension.options?.[0] ?? '未判断';
}

function normalizeStringArray(value: unknown, transcript: string, maxItems: number | undefined): string[] {
  const fallback = extractKeywords(transcript, maxItems ?? 5);
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
      .slice(0, maxItems ?? 5);
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/[\n,，;；]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, maxItems ?? 5);
  }
  return fallback;
}

function buildFallbackResult(template: AnalysisTemplate, transcript: string, newText: string): AnalysisResult {
  const dimensions = template.dimensions.reduce<Record<string, DimensionValue>>((acc, dimension) => {
    acc[dimension.key] = {
      key: dimension.key,
      label: dimension.label,
      type: dimension.type,
      value: buildFallbackValue(dimension, transcript, newText)
    };
    return acc;
  }, {});

  return {
    dimensions,
    summary: summarizeTranscript(newText || transcript),
    confidence: transcript.trim() ? 0.45 : 0.2
  };
}

function buildFallbackValue(dimension: AnalysisDimension, transcript: string, newText: string): unknown {
  const source = newText || transcript;
  switch (dimension.type) {
    case 'score':
    case 'progress':
      return estimateScore(source);
    case 'boolean':
      return detectBoolean(source);
    case 'list':
      return splitSentences(source, dimension.maxItems ?? 4);
    case 'tags':
      return extractKeywords(source, dimension.maxItems ?? 5);
    case 'enum':
      return dimension.options?.find((option) => source.includes(option)) ?? dimension.options?.[0] ?? '未判断';
    case 'text':
    case 'comparison':
      return summarizeTranscript(source);
    default:
      return summarizeTranscript(source);
  }
}

function summarizeTranscript(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return '暂无可分析内容';
  }
  return cleaned.length > 120 ? `${cleaned.slice(0, 120)}...` : cleaned;
}

function estimateScore(text: string): number {
  const lengthFactor = Math.min(70, Math.round(text.trim().length / 4));
  const punctuationBonus = Math.min(20, (text.match(/[。！？!?]/g) || []).length * 5);
  return Math.max(10, Math.min(100, lengthFactor + punctuationBonus + 10));
}

function detectBoolean(text: string): boolean {
  return /(确认|完成|同意|可以|支持|通过|已经|明确)/.test(text);
}

function splitSentences(text: string, limit: number): string[] {
  const items = text
    .split(/[。！？!?\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 4);
  return items.slice(0, limit);
}

function extractKeywords(text: string, limit: number): string[] {
  const matches = text.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,12}/g) ?? [];
  const stopWords = new Set(['我们', '你们', '他们', '这个', '那个', '进行', '需要', '已经', '如果', '然后', '就是', '一下']);
  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const match of matches) {
    if (stopWords.has(match) || seen.has(match)) {
      continue;
    }
    seen.add(match);
    keywords.push(match);
    if (keywords.length >= limit) {
      break;
    }
  }

  return keywords.length > 0 ? keywords : ['待分析'];
}
