/**
 * ProviderInjector — Provider 配置注入
 *
 * 负责将 Provider 配置注入到 AgentRuntimeBuilder：
 *   - API Key + model + baseURL
 *   - 默认思维链级别
 *
 * 由 AgentExecutor 在创建 Builder 的唯一位置调用。
 *
 * 使用按需引用模式，直接从 @main/config 导入配置服务。
 */

import { Models, Providers } from '@main/config';
import type { ProviderConfig } from './types';
import { resolveApiKey } from './ApiKeyResolver';

interface ProviderConfigurableBuilder {
  fromProviderConfig(config: ProviderConfig, modelId?: string): unknown;
  model(model: string): unknown;
  thinkingLevel?(level: unknown): unknown;
}

export class ProviderInjector {
  /**
   * 应用模型相关配置到 Builder。
   *
   * AgentExecutor 只需要知道“这次是否有模型覆盖”，Provider/API Key/思维链默认值
   * 都收在这里处理，避免执行层继续携带多余参数。
   */
  apply(builder: ProviderConfigurableBuilder, modelOverride?: string): void {
    this.applyProviderConfig(builder, modelOverride);
    this.applyThinkingLevel(builder);
  }

  /**
   * 注入 Provider 配置到 Builder（API Key + 模型 + baseURL）
   *
   * 支持 providerId/modelId 格式，通过 Models 服务解析。
   * 如果配置未就绪或无可用配置，静默回退。
   */
  private applyProviderConfig(builder: ProviderConfigurableBuilder, modelOverride?: string): void {
    try {
      // 解析模型（优先使用 modelOverride，否则使用全局默认）
      const modelSpec = modelOverride || Models.getDefaultModel();
      const resolved = Models.resolveModel(modelSpec);
      if (!resolved) {
        console.warn(`[ProviderInjector] 无法解析模型: ${modelSpec}`);
        return;
      }

      // 获取 Provider 配置
      const provider = Providers.getProvider(resolved.provider.id);
      if (!provider) {
        console.warn(`[ProviderInjector] Provider 不存在: ${resolved.provider.id}`);
        return;
      }

      // 解析 API Key
      const apiKey = resolveApiKey(provider.apiKey, provider.id);
      if (!apiKey) {
        console.warn(`[ProviderInjector] API Key 未配置: ${provider.id}`);
        return;
      }

      // 注入到 Builder
      builder.fromProviderConfig(provider as ProviderConfig, resolved.model.id);

      // 如果是显式传入了覆盖参数（如 threadModelOverride），则强制更新 builder 的 model
      // 注意：只传递模型 ID，不包含 provider 前缀，因为 OpenAI 兼容 API 只接受模型 ID
      if (modelOverride) {
        builder.model(resolved.model.id);
      }
    } catch (err) {
      console.error('[ProviderInjector] applyProviderConfig 失败:', err);
    }
  }

  /**
   * 注入默认思维链级别到 Builder
   *
   * 从 coobee.json5 读取 models.defaults.thinkingLevel，默认 'medium'。
   * 注意：这是同步方法，使用延迟导入避免循环依赖。
   */
  private applyThinkingLevel(builder: ProviderConfigurableBuilder): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { configStoreInstance } = require('@main/common/config/ConfigStore');
      const config = configStoreInstance?.getAll?.();
      const level = config?.models?.defaults?.thinkingLevel;
      if (level && typeof builder.thinkingLevel === 'function') {
        builder.thinkingLevel(level);
        return;
      }
    } catch {
      // 静默回退
    }
    if (typeof builder.thinkingLevel === 'function') {
      builder.thinkingLevel('medium');
    }
  }
}
