/**
 * Threads API 客户端
 *
 * 封装任务会话相关的 HTTP API 调用
 */

import { apiClient } from './client';
import type { ApiResponse } from '@shared/api';
import type { DeleteThreadRespVO, UpdateThreadReqVO, UpdateThreadRespVO } from '@shared/api/thread-types';
import type { ThreadEntry } from '@shared/events/thread';

export type { ThreadEntry };

/** Thread 列表响应 */
export interface ListThreadsResponse {
  threads: ThreadEntry[];
  pagination?: {
    total: number;
    offset: number;
    limit: number;
  };
}

/** Thread 历史响应 */
export interface ThreadHistoryResponse {
  messages: Array<{
    role: 'user' | 'assistant';
    content: Array<{
      type: 'text' | 'thinking' | 'tool_use' | 'tool_result';
      text?: string;
      thinking?: string;
      [key: string]: unknown;
    }>;
    timestamp: number;
    usage?: {
      input?: number;
      output?: number;
      totalTokens?: number;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }>;
}

/** 更新 Thread 参数 */
export type UpdateThreadParams = UpdateThreadReqVO;

// ==================== API 方法 ====================

/**
 * 获取 Thread 列表
 */
export async function getThreads(params?: {
  offset?: number;
  limit?: number;
  agentId?: string;
}): Promise<ApiResponse<ListThreadsResponse>> {
  const queryParams = new URLSearchParams();
  if (params?.offset !== undefined) queryParams.append('offset', String(params.offset));
  if (params?.limit !== undefined) queryParams.append('limit', String(params.limit));
  if (params?.agentId) queryParams.append('agentId', params.agentId);

  const query = queryParams.toString();
  const path = query ? `/gateway/threads?${query}` : '/gateway/threads';

  return apiClient.get<ListThreadsResponse>(path);
}

/**
 * 获取单个 Thread 详情
 */
export async function getThread(threadId: string): Promise<ApiResponse<{ thread: ThreadEntry }>> {
  return apiClient.get<{ thread: ThreadEntry }>(`/gateway/threads/${threadId}`);
}

/**
 * 更新 Thread（部分更新）
 */
export async function updateThread(
  threadId: string,
  updates: UpdateThreadParams
): Promise<ApiResponse<UpdateThreadRespVO>> {
  return apiClient.patch<UpdateThreadRespVO>(`/gateway/threads/${threadId}`, updates);
}

/**
 * 获取 Thread 历史消息
 */
export async function getThreadHistory(threadId: string): Promise<ApiResponse<ThreadHistoryResponse>> {
  return apiClient.get<ThreadHistoryResponse>(`/gateway/threads/${threadId}/history`);
}

/**
 * 删除 Thread
 */
export async function deleteThread(threadId: string): Promise<ApiResponse<DeleteThreadRespVO>> {
  return apiClient.delete<DeleteThreadRespVO>(`/gateway/threads/${threadId}`);
}
