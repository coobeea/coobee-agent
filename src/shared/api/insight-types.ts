/**
 * Insight API 类型定义
 *
 * 前后端共享的请求/响应类型（VO - View Object）。
 */

import type { ApiResponse } from '@shared/api';
import type {
  AnalysisDimension,
  AnalysisSnapshot,
  AnalysisTemplate,
  InsightAnalysisTrigger,
  InsightSession,
  RefreshStrategy
} from '@shared/types/insight';

export type { ApiResponse };
export type { AnalysisSnapshot, AnalysisTemplate, InsightAnalysisTrigger, InsightSession };

export interface ListInsightTemplatesRespVO {
  templates: AnalysisTemplate[];
}

export interface CreateInsightTemplateDimensionReqVO {
  label: string;
  prompt: string;
  type?: AnalysisDimension['type'];
  options?: string[];
  maxItems?: number;
  showTrend?: boolean;
  required?: boolean;
}

export interface CreateInsightTemplateReqVO {
  name: string;
  description: string;
  icon?: string;
  analysisPrompt?: string;
  refreshStrategy?: RefreshStrategy;
  dimensions: CreateInsightTemplateDimensionReqVO[];
}

export interface CreateInsightTemplateRespVO {
  template: AnalysisTemplate;
}

export interface GetInsightTemplateRespVO {
  template: AnalysisTemplate;
}

export interface UpdateInsightTemplateReqVO {
  name: string;
  description: string;
  icon?: string;
  analysisPrompt?: string;
  refreshStrategy?: RefreshStrategy;
  dimensions: CreateInsightTemplateDimensionReqVO[];
}

export interface UpdateInsightTemplateRespVO {
  template: AnalysisTemplate;
}

export interface DeleteInsightTemplateRespVO {
  templateId: string;
}

export interface CreateInsightSessionReqVO {
  templateId: string;
  agentId?: string;
  initialText?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateInsightSessionRespVO {
  session: InsightSession;
}

export interface ListActiveInsightSessionsRespVO {
  sessions: InsightSession[];
}

export interface ListInsightSessionsRespVO {
  sessions: InsightSession[];
}

export interface GetInsightSessionRespVO {
  session: InsightSession;
}

export interface AppendInsightTextReqVO {
  text: string;
}

export interface AppendInsightTextRespVO {
  session: InsightSession;
  appendedLength: number;
}

export interface AppendInsightTranscriptReqVO {
  text: string;
}

export interface AppendInsightTranscriptRespVO {
  session: InsightSession;
  appendedLength: number;
}

export interface AnalyzeInsightSessionReqVO {
  trigger?: InsightAnalysisTrigger;
}

export interface AnalyzeInsightSessionRespVO {
  session: InsightSession;
  snapshot: AnalysisSnapshot;
  usedFallback: boolean;
}

export interface CompleteInsightSessionRespVO {
  session: InsightSession;
}

export interface PauseInsightSessionRespVO {
  session: InsightSession;
}

export interface ResumeInsightSessionRespVO {
  session: InsightSession;
}

export interface ListInsightSnapshotsRespVO {
  snapshots: AnalysisSnapshot[];
}
