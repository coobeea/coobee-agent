/**
 * Models 配置模块
 *
 * 统一的模型解析和访问服务，连接主配置和 Providers 配置
 *
 * 职责：
 *   - 获取全局默认模型
 *   - 解析模型标识符（providerId/modelId）
 *   - 返回 Provider + Model 的完整信息
 *
 * 使用示例：
 * ```typescript
 * import { Models } from '@main/config/models';
 *
 * // 获取默认模型
 * const defaultModel = Models.getDefaultModel();
 * // 返回: 'ollama/gemma4:e4b'
 *
 * // 解析模型（自动使用默认）
 * const { provider, model } = Models.resolveModel(agent.model);
 * // 返回完整的 Provider 和 Model 信息
 * ```
 */

import { configStoreInstance } from '@main/common/config/ConfigStore';
import { Providers } from './providers';

export interface ResolvedModel {
  /** Provider 信息 */
  provider: {
    id: string;
    name: string;
    baseUrl: string;
    apiKey?: string;
    api: 'openai-compatible' | 'anthropic' | 'google';
    enabled: boolean;
  };
  /** Model 信息 */
  model: {
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
    features?: string[];
  };
  /** 完整的模型标识符 'providerId/modelId' */
  fullSpec: string;
}

export class Models {
  /**
   * 获取全局默认模型标识符
   *
   * 从主配置 coobee.json5 的 models.defaults.model.primary 读取
   *
   * @returns 模型标识符，格式：'providerId/modelId'，如 'ollama/gemma4:e4b'
   * @throws 如果未配置默认模型
   */
  static getDefaultModel(): string {
    if (!configStoreInstance) {
      throw new Error('ConfigStore 未初始化');
    }

    const config = configStoreInstance.getAll();
    const defaultSpec = config.models?.defaults?.model?.primary;

    if (!defaultSpec) {
      throw new Error('未配置默认模型：请在 coobee.json5 中设置 models.defaults.model.primary');
    }

    return defaultSpec;
  }

  /**
   * 获取全局默认 Embedding 模型标识符
   *
   * @returns Embedding 模型标识符
   */
  static getDefaultEmbeddingModel(): string {
    if (!configStoreInstance) {
      throw new Error('ConfigStore 未初始化');
    }

    const config = configStoreInstance.getAll();
    // 从 config.models.defaults.embedding.primary 读取（已在 schema.ts 中定义）
    return config.models?.defaults?.embedding?.primary || 'dashscope/text-embedding-v4';
  }

  /**
   * 获取全局默认思考级别
   *
   * @returns 思考级别
   */
  static getDefaultThinkingLevel(): string {
    if (!configStoreInstance) {
      return 'medium';
    }

    const config = configStoreInstance.getAll();
    return config.models?.defaults?.thinkingLevel || 'medium';
  }

  /**
   * 解析模型标识符，返回完整的 Provider + Model 信息
   *
   * 解析优先级：
   *   1. 如果提供了 modelSpec，使用指定的模型
   *   2. 如果 modelSpec 为 null/undefined，使用全局默认模型
   *
   * @param modelSpec 模型标识符，格式：'providerId/modelId'，如 'ollama/qwen3.5:9b'
   *                  传入 null/undefined 时使用全局默认模型
   * @returns 解析后的完整模型信息
   * @throws 如果模型标识符无效、Provider 不存在或模型不存在
   *
   * @example
   * // 使用指定模型
   * const resolved = Models.resolveModel('ollama/qwen3.5:9b');
   *
   * // 使用默认模型
   * const resolved = Models.resolveModel();
   * const resolved = Models.resolveModel(null);
   */
  static resolveModel(modelSpec?: string | null): ResolvedModel {
    // 如果没有指定，使用默认模型
    const spec = modelSpec || this.getDefaultModel();

    // 解析 providerId/modelId
    const parts = spec.split('/');
    if (parts.length !== 2) {
      throw new Error(`无效的模型标识符: ${spec}，格式应为 'providerId/modelId'`);
    }

    const [providerId, modelId] = parts;

    if (!providerId || !modelId) {
      throw new Error(`无效的模型标识符: ${spec}，providerId 和 modelId 不能为空`);
    }

    // 从 Providers 获取 Provider 信息
    const provider = Providers.getProvider(providerId);
    if (!provider) {
      const available = Providers.getEnabled()
        .map((p) => p.id)
        .join(', ');
      throw new Error(`Provider 未找到: ${providerId}，可用的 Provider: ${available || '(无)'}`);
    }

    // 查找模型
    const model = provider.models.find((m) => m.id === modelId);
    if (!model) {
      const availableModels = provider.models.map((m) => m.id).join(', ');
      throw new Error(`模型未找到: ${providerId}/${modelId}，${providerId} 可用的模型: ${availableModels || '(无)'}`);
    }

    // 返回解析后的完整信息
    return {
      provider: {
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        api: provider.api,
        enabled: provider.enabled
      },
      model: {
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        maxInputTokens: model.maxInputTokens,
        maxOutputTokens: model.maxOutputTokens,
        maxThinkingTokens: model.maxThinkingTokens,
        reasoning: model.reasoning,
        vision: model.vision,
        functionCalling: model.functionCalling,
        webSearch: model.webSearch,
        free: model.free,
        features: model.features
      },
      fullSpec: spec
    };
  }

  /**
   * 验证模型标识符是否有效
   *
   * @param modelSpec 模型标识符
   * @returns 是否有效
   */
  static isValidModel(modelSpec: string): boolean {
    try {
      this.resolveModel(modelSpec);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 列出所有可用的模型标识符
   *
   * @returns 所有模型的 'providerId/modelId' 列表
   */
  static listAllModels(): string[] {
    const providers = Providers.getAll();
    const models: string[] = [];

    for (const provider of Object.values(providers)) {
      if (!provider.enabled) continue;

      for (const model of provider.models) {
        models.push(`${provider.id}/${model.id}`);
      }
    }

    return models;
  }

  /**
   * 获取推荐的模型列表（已启用的 Provider 的模型）
   *
   * @returns 推荐模型列表，包含完整信息
   */
  static getRecommendedModels(): Array<{
    spec: string;
    providerName: string;
    modelName: string;
    features: string[];
  }> {
    const providers = Providers.getEnabled();
    const recommended: Array<{
      spec: string;
      providerName: string;
      modelName: string;
      features: string[];
    }> = [];

    for (const provider of providers) {
      for (const model of provider.models) {
        recommended.push({
          spec: `${provider.id}/${model.id}`,
          providerName: provider.name,
          modelName: model.name,
          features: model.features || []
        });
      }
    }

    return recommended;
  }
}
