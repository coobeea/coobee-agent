/**
 * Provider 配置管理器
 *
 * 统一管理 Provider 配置的加载，支持两种模式：
 *   1. 从 coobee.json5 加载（兼容模式）
 *   2. 从 providers.json5 加载（推荐模式）
 *
 * 自动检测配置文件位置并使用对应的加载器。
 */

import fs from 'fs';
import path from 'path';
import { log } from '@main/common/logger';
import { Providers, type ProviderConfigSource } from '@main/config/providers';
import type { ProviderRegistry } from './ProviderRegistry';
import type { ProviderConfig } from './types';

type ProviderConfigLoader = ReturnType<typeof Providers.getLoader>;

export class ProviderConfigManager {
  private loader: ProviderConfigLoader | null = null;
  private configDir: string;
  private secretsDir: string;

  constructor(configDir: string, secretsDir: string) {
    this.configDir = configDir;
    this.secretsDir = secretsDir;
  }

  /**
   * 初始化配置加载器
   */
  init(): void {
    this.loader = Providers.getLoader(this.configDir, this.secretsDir);
    this.loader.startWatch(); // 启动热重载
  }

  /**
   * 加载 Provider 配置到 Registry
   *
   * 优先级：
   *   1. providers.json5（如果存在）
   *   2. coobee.json5 中的 models.providers（兼容模式）
   */
  loadToRegistry(registry: ProviderRegistry): void {
    const providersPath = path.join(this.configDir, 'providers.json5');

    // 检查是否使用独立配置文件
    if (fs.existsSync(providersPath)) {
      log.info('[ProviderConfigManager] Loading from providers.json5');
      this.loadFromProvidersFile(registry);
    } else {
      log.info('[ProviderConfigManager] Loading from coobee.json5 (legacy mode)');
      this.loadFromCoobeeConfig(registry);
    }
  }

  /**
   * 从 providers.json5 加载
   */
  private loadFromProvidersFile(registry: ProviderRegistry): void {
    if (!this.loader) {
      this.init();
    }

    const config = this.loader!.load();
    this.registerProviders(registry, config);
  }

  /**
   * 从 coobee.json5 加载（兼容模式）
   */
  private loadFromCoobeeConfig(registry: ProviderRegistry): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { configStoreInstance } = require('@main/common/config/ConfigStore');
      const coobeeConfig = configStoreInstance?.getAll?.();

      if (coobeeConfig?.models?.providers) {
        this.registerProviders(registry, coobeeConfig.models.providers);
      } else {
        log.warn('[ProviderConfigManager] No providers found in coobee.json5');
      }
    } catch (error) {
      log.error('[ProviderConfigManager] Failed to load from coobee.json5:', error);
    }
  }

  /**
   * 注册 Providers 到 Registry
   */
  private registerProviders(registry: ProviderRegistry, source: ProviderConfigSource): void {
    registry.clear();

    for (const [id, providerConf] of Object.entries(source)) {
      const config: ProviderConfig = {
        id,
        name: providerConf.name ?? id,
        baseUrl: providerConf.baseUrl,
        apiKey: providerConf.apiKey,
        api: providerConf.api,
        models: providerConf.models.map((m) => ({
          id: m.id,
          name: m.name,
          reasoning: m.reasoning ?? false,
          input: m.input?.filter((type): type is 'text' | 'image' => type === 'text' || type === 'image') ?? ['text'],
          contextWindow: m.contextWindow,
          maxTokens: m.maxOutputTokens,
          cost: m.cost
        })),
        enabled: providerConf.enabled ?? true
      };

      registry.register(config);
    }

    log.info(`[ProviderConfigManager] Registered ${registry.size} providers`);
  }

  /**
   * 保存 Provider 配置
   *
   * 如果使用独立文件模式，保存到 providers.json5；
   * 否则保存到 coobee.json5。
   */
  saveProvider(providerId: string, config: ProviderConfig): void {
    const providersPath = path.join(this.configDir, 'providers.json5');

    if (fs.existsSync(providersPath)) {
      // 保存到 providers.json5
      if (!this.loader) {
        this.init();
      }

      const currentConfig = this.loader!.load();
      currentConfig[providerId] = this.convertToSource(config);
      this.loader!.save(currentConfig);
    } else {
      // 保存到 coobee.json5（兼容模式）
      log.warn('[ProviderConfigManager] Saving to coobee.json5 (legacy mode)');
      // TODO: 实现保存到 coobee.json5 的逻辑
    }
  }

  /**
   * 转换 ProviderConfig 为 ProviderConfigSource 格式
   */
  private convertToSource(config: ProviderConfig): ProviderConfigSource[string] {
    return {
      id: config.id,
      name: config.name,
      api: config.api,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      enabled: config.enabled,
      models: config.models.map((m) => ({
        id: m.id,
        name: m.name,
        api: m.api,
        reasoning: m.reasoning,
        input: m.input as string[] | undefined,
        contextWindow: m.contextWindow,
        maxOutputTokens: m.maxTokens,
        cost: m.cost
      }))
    };
  }

  /**
   * 停止配置监听
   */
  destroy(): void {
    if (this.loader) {
      this.loader.stopWatch();
      this.loader = null;
    }
  }
}
