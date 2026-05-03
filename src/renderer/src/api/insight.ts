import type {
  AnalyzeInsightSessionRespVO,
  ApiResponse,
  AppendInsightTextRespVO,
  AppendInsightTranscriptRespVO,
  CompleteInsightSessionRespVO,
  CreateInsightTemplateReqVO,
  CreateInsightTemplateRespVO,
  CreateInsightSessionReqVO,
  CreateInsightSessionRespVO,
  GetInsightSessionRespVO,
  ListActiveInsightSessionsRespVO,
  ListInsightSessionsRespVO,
  ListInsightSnapshotsRespVO,
  ListInsightTemplatesRespVO,
  PauseInsightSessionRespVO,
  ResumeInsightSessionRespVO
} from '@shared/api/insight-types';
import type { InsightAnalysisTrigger } from '@shared/types/insight';
import { apiClient } from './client';

export async function getInsightTemplates(): Promise<ApiResponse<ListInsightTemplatesRespVO>> {
  return apiClient.get<ListInsightTemplatesRespVO>('/gateway/insight/templates');
}

export async function createInsightTemplate(
  body: CreateInsightTemplateReqVO
): Promise<ApiResponse<CreateInsightTemplateRespVO>> {
  return apiClient.post<CreateInsightTemplateRespVO>('/gateway/insight/templates', body);
}

export async function createInsightSession(
  body: CreateInsightSessionReqVO
): Promise<ApiResponse<CreateInsightSessionRespVO>> {
  return apiClient.post<CreateInsightSessionRespVO>('/gateway/insight/sessions', body);
}

export async function getActiveInsightSessions(): Promise<ApiResponse<ListActiveInsightSessionsRespVO>> {
  return apiClient.get<ListActiveInsightSessionsRespVO>('/gateway/insight/sessions/active');
}

export async function getInsightSessions(): Promise<ApiResponse<ListInsightSessionsRespVO>> {
  return apiClient.get<ListInsightSessionsRespVO>('/gateway/insight/sessions');
}

export async function getInsightSession(sessionId: string): Promise<ApiResponse<GetInsightSessionRespVO>> {
  return apiClient.get<GetInsightSessionRespVO>(`/gateway/insight/sessions/${sessionId}`);
}

export async function appendInsightText(
  sessionId: string,
  text: string
): Promise<ApiResponse<AppendInsightTextRespVO>> {
  return apiClient.post<AppendInsightTextRespVO>(`/gateway/insight/sessions/${sessionId}/text`, { text });
}

export async function appendInsightTranscript(
  sessionId: string,
  text: string
): Promise<ApiResponse<AppendInsightTranscriptRespVO>> {
  return apiClient.post<AppendInsightTranscriptRespVO>(`/gateway/insight/sessions/${sessionId}/transcript`, { text });
}

export async function analyzeInsightSession(
  sessionId: string,
  trigger: InsightAnalysisTrigger = 'manual'
): Promise<ApiResponse<AnalyzeInsightSessionRespVO>> {
  return apiClient.post<AnalyzeInsightSessionRespVO>(`/gateway/insight/sessions/${sessionId}/analyze`, { trigger });
}

export async function completeInsightSession(sessionId: string): Promise<ApiResponse<CompleteInsightSessionRespVO>> {
  return apiClient.put<CompleteInsightSessionRespVO>(`/gateway/insight/sessions/${sessionId}/complete`);
}

export async function pauseInsightSession(sessionId: string): Promise<ApiResponse<PauseInsightSessionRespVO>> {
  return apiClient.put<PauseInsightSessionRespVO>(`/gateway/insight/sessions/${sessionId}/pause`);
}

export async function resumeInsightSession(sessionId: string): Promise<ApiResponse<ResumeInsightSessionRespVO>> {
  return apiClient.put<ResumeInsightSessionRespVO>(`/gateway/insight/sessions/${sessionId}/resume`);
}

export async function getInsightSnapshots(sessionId: string): Promise<ApiResponse<ListInsightSnapshotsRespVO>> {
  return apiClient.get<ListInsightSnapshotsRespVO>(`/gateway/insight/sessions/${sessionId}/snapshots`);
}
