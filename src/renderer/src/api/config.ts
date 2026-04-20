/**
 * 配置管理 API 客户端
 *
 * 通过 HTTP REST 接口与后端通信，管理模型供应商配置。
 */

import type {
  ApiResponse,
  ProviderConfig,
  SecretStatus,
  GetProvidersRespVO,
  GetSecretsStatusRespVO,
  TestProviderRespVO,
  GetDefaultModelRespVO,
  UpdateDefaultModelReqVO
} from '@shared/api/config-types';
import { apiClient } from './client';

// 重新导出类型供外部使用
export type { ProviderConfig, SecretStatus };

// ==================== API 方法 ====================

/**
 * 获取所有 Providers 配置（API Key 已脱敏）
 */
export async function getProviders(): Promise<ApiResponse<GetProvidersRespVO>> {
  return apiClient.get<GetProvidersRespVO>('/gateway/config/providers');
}

/**
 * 获取 Secrets 状态（只返回是否已配置）
 */
export async function getSecretsStatus(): Promise<ApiResponse<GetSecretsStatusRespVO>> {
  return apiClient.get<GetSecretsStatusRespVO>('/gateway/config/secrets/status');
}

/**
 * 保存供应商 API Key
 *
 * @param providerId Provider ID
 * @param apiKey API Key
 */
export async function saveProviderKey(providerId: string, apiKey: string): Promise<ApiResponse> {
  return apiClient.post(`/gateway/config/providers/${providerId}/key`, { apiKey });
}

/**
 * 更新供应商配置
 *
 * @param providerId Provider ID
 * @param updates 要更新的字段
 */
export async function updateProvider(
  providerId: string,
  updates: Partial<Omit<ProviderConfig, 'id' | 'apiKey' | '_hasApiKey'>>
): Promise<ApiResponse> {
  return apiClient.patch(`/gateway/config/providers/${providerId}`, updates);
}

/**
 * 更新供应商 Base URL
 *
 * @param providerId Provider ID
 * @param baseUrl 新的 Base URL
 */
export async function updateProviderBaseUrl(providerId: string, baseUrl: string): Promise<ApiResponse> {
  return updateProvider(providerId, { baseUrl });
}

/**
 * 切换供应商启用状态
 *
 * @param providerId Provider ID
 * @param enabled 是否启用
 */
export async function toggleProvider(providerId: string, enabled: boolean): Promise<ApiResponse> {
  return apiClient.put(`/gateway/config/providers/${providerId}/enabled`, { enabled });
}

/**
 * 测试供应商连接
 *
 * @param providerId Provider ID
 */
export async function testProvider(providerId: string): Promise<ApiResponse<TestProviderRespVO>> {
  return apiClient.post<TestProviderRespVO>(`/gateway/config/providers/${providerId}/test`);
}

// ==================== 默认模型 API ====================

/**
 * 获取默认模型
 */
export async function getDefaultModel(): Promise<ApiResponse<GetDefaultModelRespVO>> {
  return apiClient.get<GetDefaultModelRespVO>('/gateway/config/default-model');
}

/**
 * 更新默认模型
 * @param modelId 模型 ID
 */
export async function updateDefaultModel(modelId: string): Promise<ApiResponse<void>> {
  const body: UpdateDefaultModelReqVO = { modelId };
  return apiClient.put<void>('/gateway/config/default-model', body);
}

// ==================== 使用示例 ====================

/**
 * 示例：加载并显示所有 Providers
 */
export async function exampleLoadProviders(): Promise<void> {
  const result = await getProviders();
  if (result.success && result.data) {
    console.log('Providers:', result.data.providers);
    // 遍历所有 providers
    for (const [id, provider] of Object.entries(result.data.providers)) {
      console.log(`- ${provider.name} (${id}): ${provider.enabled ? 'enabled' : 'disabled'}`);
    }
  } else {
    console.error('Failed to load providers:', result.error);
  }
}

/**
 * 示例：保存 API Key
 */
export async function exampleSaveApiKey(): Promise<void> {
  const result = await saveProviderKey('dashscope', 'sk-your-api-key-here');
  if (result.success) {
    console.log('API Key saved successfully');
  } else {
    console.error('Failed to save API Key:', result.error);
  }
}

/**
 * 示例：切换启用状态
 */
export async function exampleToggleProvider(): Promise<void> {
  const result = await toggleProvider('dashscope', true);
  if (result.success) {
    console.log('Provider enabled');
  } else {
    console.error('Failed to toggle provider:', result.error);
  }
}

/**
 * 示例：测试连接
 */
export async function exampleTestConnection(): Promise<void> {
  const result = await testProvider('dashscope');
  if (result.success && result.data) {
    console.log('Connection test:', result.data);
    console.log(`Connected: ${result.data.connected}, Latency: ${result.data.latency}ms`);
  } else {
    console.error('Connection test failed:', result.error);
  }
}
