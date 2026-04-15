/**
 * 配置管理 API 类型定义
 * 
 * 前后端共享的请求/响应类型定义（VO - View Object）
 */

import type { ApiResponse } from '@shared/api';

// 重新导出供外部使用
export type { ApiResponse };

// ==================== Provider 相关类型 ====================

/**
 * Provider 配置
 */
export interface ProviderConfig {
  id: string;
  name: string;
  description?: string;
  api: 'openai-compatible' | 'anthropic' | 'google';
  baseUrl: string;
  apiKey?: string;
  requiresApiKey?: boolean;
  enabled: boolean;
  billingMode?: 'pay-as-you-go' | 'subscription';
  websites?: {
    official?: string;
    apiKey?: string;
    docs?: string;
    models?: string;
  };
  models: ModelConfig[];
  /** 是否已配置 API Key（后端添加） */
  _hasApiKey?: boolean;
}

/**
 * Model 配置
 */
export interface ModelConfig {
  id: string;
  name: string;
  contextWindow?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxThinkingTokens?: number;
  reasoning?: boolean;
  vision?: boolean;
  functionCalling?: boolean;
  webSearch?: boolean;
  free?: boolean;
  supportsEmbedding?: boolean;
  embeddingDimensions?: number[];
  defaultDimension?: number;
  input?: string[];
  features?: string[];
  cost?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
}

/**
 * Providers 配置字典
 */
export type ProvidersConfig = Record<string, ProviderConfig>;

/**
 * Secret 状态
 */
export interface SecretStatus {
  hasKey: boolean;
  masked?: string;
}

/**
 * Secrets 状态字典
 */
export type SecretsStatus = Record<string, SecretStatus>;

// ==================== API 请求/响应类型 ====================

/**
 * GET /config/providers
 * 获取所有 Providers 配置
 */
export interface GetProvidersReqVO {
  // 无请求参数
}

export interface GetProvidersRespVO {
  providers: ProvidersConfig;
}

/**
 * GET /config/secrets/status
 * 获取 Secrets 状态
 */
export interface GetSecretsStatusReqVO {
  // 无请求参数
}

export interface GetSecretsStatusRespVO {
  secrets: SecretsStatus;
}

/**
 * POST /config/providers/:id/key
 * 保存 Provider API Key
 */
export interface SaveProviderKeyReqVO {
  providerId: string; // 来自 URL 参数
  apiKey: string;
}

export interface SaveProviderKeyRespVO {
  // 无返回数据，只有 success 标志
}

/**
 * PATCH /config/providers/:id
 * 更新 Provider 配置
 */
export interface UpdateProviderReqVO {
  providerId: string; // 来自 URL 参数
  updates: Partial<Omit<ProviderConfig, 'id' | 'apiKey' | '_hasApiKey'>>;
}

export interface UpdateProviderRespVO {
  // 无返回数据，只有 success 标志
}

/**
 * PUT /config/providers/:id/enabled
 * 切换 Provider 启用状态
 */
export interface ToggleProviderReqVO {
  providerId: string; // 来自 URL 参数
  enabled: boolean;
}

export interface ToggleProviderRespVO {
  // 无返回数据，只有 success 标志
}

/**
 * POST /config/providers/:id/test
 * 测试 Provider 连接
 */
export interface TestProviderReqVO {
  providerId: string; // 来自 URL 参数
}

export interface TestProviderRespVO {
  providerId: string;
  connected: boolean;
  latency: number;
}

// ==================== 默认模型相关类型 ====================

export interface GetDefaultModelRespVO {
  modelId: string;
}

export interface UpdateDefaultModelReqVO {
  modelId: string;
}
