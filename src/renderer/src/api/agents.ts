/**
 * Agents API 客户端
 *
 * 封装智能体相关的 HTTP API 调用
 */

import { apiClient } from './client';
import type { ApiResponse } from '@shared/api';
import configManager from '@/config';

/** Agent 创建来源 */
export type AgentCreatedBy = 'user' | 'agent' | 'system';

/** Agent 默认 Runtime 选择 */
export type AgentRuntimeType = 'pi-mono' | 'openai' | 'claude';

/** Agent 索引条目（轻量版，用于列表展示） */
export interface AgentEntry {
  id: string;
  name: string;
  description: string;
  createdBy: AgentCreatedBy;
  version: number;
  updatedAt: string;
  skills?: string[];
  model?: string;
  runtimeType?: AgentRuntimeType;
  enableThinking?: boolean;
  asrEnabled?: boolean;
  ttsEnabled?: boolean;
}

/** Agent 完整定义 */
export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  instructions: string;
  excludeTools?: string[];
  skills?: string[];
  model?: string;
  runtimeType?: AgentRuntimeType;
  enableThinking?: boolean;
  asrEnabled?: boolean;
  ttsEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: AgentCreatedBy;
  version: number;
  metadata?: Record<string, unknown>;
}

/** 创建 Agent 参数 */
export interface CreateAgentParams {
  id: string;
  name: string;
  description: string;
  instructions: string;
  excludeTools?: string[];
  skills?: string[];
  model?: string;
  runtimeType?: AgentRuntimeType;
  enableThinking?: boolean;
  asrEnabled?: boolean;
  ttsEnabled?: boolean;
  metadata?: Record<string, unknown>;
}

/** 更新 Agent 参数 */
export interface UpdateAgentParams {
  name?: string;
  description?: string;
  instructions?: string;
  excludeTools?: string[];
  skills?: string[];
  model?: string;
  runtimeType?: AgentRuntimeType;
  enableThinking?: boolean;
  asrEnabled?: boolean;
  ttsEnabled?: boolean;
  metadata?: Record<string, unknown>;
}

// ==================== API 响应类型 ====================

interface ListAgentsResponse {
  agents: AgentEntry[];
}

interface GetAgentResponse {
  agent: AgentDefinition;
}

interface CreateAgentResponse {
  agent: AgentDefinition;
}

interface UpdateAgentResponse {
  agent: AgentDefinition;
}

interface DeleteAgentResponse {
  agentId: string;
  deleted: boolean;
}

// ==================== API 方法 ====================

/**
 * 获取智能体列表
 */
export async function getAgents(): Promise<ApiResponse<ListAgentsResponse>> {
  return apiClient.get<ListAgentsResponse>('/gateway/agents');
}

/**
 * 获取智能体详情
 */
export async function getAgent(agentId: string): Promise<ApiResponse<GetAgentResponse>> {
  return apiClient.get<GetAgentResponse>(`/gateway/agents/${agentId}`);
}

/**
 * 创建智能体
 */
export async function createAgent(params: CreateAgentParams): Promise<ApiResponse<CreateAgentResponse>> {
  return apiClient.post<CreateAgentResponse>('/gateway/agents', params);
}

/**
 * 更新智能体（部分更新）
 */
export async function updateAgent(
  agentId: string,
  params: UpdateAgentParams
): Promise<ApiResponse<UpdateAgentResponse>> {
  return apiClient.patch<UpdateAgentResponse>(`/gateway/agents/${agentId}`, params);
}

/**
 * 删除智能体
 */
export async function deleteAgent(agentId: string): Promise<ApiResponse<DeleteAgentResponse>> {
  return apiClient.delete<DeleteAgentResponse>(`/gateway/agents/${agentId}`);
}

// ==================== Personality Files ====================

export interface GetPersonalityFilesResponse {
  files: Record<string, string>;
}

export async function getPersonalityFiles(agentId: string): Promise<ApiResponse<GetPersonalityFilesResponse>> {
  return apiClient.get<GetPersonalityFilesResponse>(`/gateway/agents/${agentId}/personality`);
}

export async function updatePersonalityFile(
  agentId: string,
  fileName: string,
  content: string
): Promise<ApiResponse<{ success: boolean }>> {
  return apiClient.put<{ success: boolean }>(`/gateway/agents/${agentId}/personality/${fileName}`, { content });
}

// ==================== Import / Export ====================

/** 导入结果 */
export interface ImportResult {
  success: boolean;
  agentId?: string;
  agentName?: string;
  error?: string;
  warnings?: string[];
}

/**
 * 导入智能体 ZIP 文件（multipart/form-data 直传二进制）
 * @param file ZIP 文件对象
 */
export async function importAgent(file: File): Promise<ApiResponse<ImportResult>> {
  const formData = new FormData();
  formData.append('file', file, file.name);

  const baseUrl = configManager.getBaseUrl();
  try {
    const response = await fetch(`${baseUrl}/gateway/agents/import`, {
      method: 'POST',
      body: formData
      // 注意：不要手动设置 Content-Type，浏览器会自动填入带 boundary 的 multipart/form-data
    });

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return (await response.json()) as ApiResponse<ImportResult>;
    }

    const text = await response.text();
    return {
      success: false,
      code: `HTTP_${response.status}`,
      error: text || `导入失败：HTTP ${response.status}`
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * 导出智能体为 ZIP 文件
 * @param agentId 智能体 ID
 * @returns Blob 对象（ZIP 文件）
 */
export async function exportAgent(agentId: string): Promise<Blob> {
  // 注意：导出需要直接使用 fetch 获取二进制数据，不能用 apiClient（返回 JSON）
  const baseUrl = configManager.getBaseUrl();
  const response = await fetch(`${baseUrl}/gateway/agents/${agentId}/export`);

  if (!response.ok) {
    throw new Error(`导出失败: ${response.statusText}`);
  }

  return response.blob();
}
