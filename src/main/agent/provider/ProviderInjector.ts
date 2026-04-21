/**
 * ProviderInjector — Provider 配置注入
 *
 * 负责将 Provider 配置注入到 PiMonoBuilder：
 *   - API Key + model + baseURL
 *   - 默认思维链级别
 *
 * 从 AgentExecutor 提取，供 chat.ts、Orchestrator、Swarm 等所有创建 Agent 的地方使用。
 *
 * 使用按需引用模式，直接从 @main/config 导入配置服务。
 */

import { Models, Providers } from '@main/config';
import { resolveApiKey } from './ApiKeyResolver';

export class ProviderInjector {
  /**
   * 注入 Provider 配置到 Builder（API Key + 模型 + baseURL）
   *
   * 支持 providerId/modelId 格式，通过 Models 服务解析。
   * 如果配置未就绪或无可用配置，静默回退。
   */
  applyProviderConfig(
    builder: import('../AgentExecutor').AgentBuilder,
    opts?: { modelOverride?: string; sessionId?: string; agentId?: string }
  ): void {
    try {
      // 解析模型（优先使用 modelOverride，否则使用全局默认）
      const modelSpec = opts?.modelOverride || Models.getDefaultModel();
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      builder.fromProviderConfig(provider as any, resolved.model.id);

      // 如果是显式传入了覆盖参数（如 threadModelOverride），则强制更新 builder 的 model
      // 注意：只传递模型 ID，不包含 provider 前缀，因为 OpenAI 兼容 API 只接受模型 ID
      if (opts?.modelOverride) {
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
  applyThinkingLevel(builder: import('../AgentExecutor').AgentBuilder): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { configStoreInstance } = require('@main/common/config/ConfigStore');
      const config = configStoreInstance?.getAll?.();
      const level = config?.models?.defaults?.thinkingLevel;
      if (level && 'thinkingLevel' in builder) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (builder as any).thinkingLevel(level);
        return;
      }
    } catch {
      // 静默回退
    }
    if ('thinkingLevel' in builder) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (builder as any).thinkingLevel('medium');
    }
  }
}
