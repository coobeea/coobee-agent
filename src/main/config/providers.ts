/**
 * Provider 配置模块
 *
 * 从独立的 providers.json5 文件加载 Provider 配置，
 * 与主配置文件 coobee.json5 分离。
 *
 * 配置文件位置：
 *   - .home/config/providers.json5
 *   - .home/secrets/secrets.json5 (API Keys)
 *
 * 优势：
 *   - 配置分离，主配置文件更简洁
 *   - Provider 配置独立维护，易于扩展
 *   - 支持热重载
 */

import fs from 'fs';
import path from 'path';
import JSON5 from 'json5';
import { log } from '@main/common/logger';
import { Env } from '@main/common/env';
import { generateDefaultProviders } from './default-template';
import type { ConfigModule } from './types';

export interface ProviderConfigSource {
  [providerId: string]: {
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
    models: Array<{
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
    }>;
  };
}

/**
 * Providers 配置管理（统一访问接口）
 *
 * 提供便捷的 Provider 查询和访问方法
 */
export class Providers {
  private static loader: ProviderConfigLoader | null = null;

  /**
   * 获取配置加载器实例（内部使用）
   */
  static getLoader(configDir?: string, secretsDir?: string): ProviderConfigLoader {
    if (!Providers.loader) {
      // 如果没有提供路径，从 Env 获取
      const finalConfigDir = configDir || Env.paths.configDir;
      const finalSecretsDir = secretsDir || Env.paths.secretsDir;
      Providers.loader = new ProviderConfigLoader(finalConfigDir, finalSecretsDir);
    }
    return Providers.loader;
  }

  /**
   * 获取所有 Provider 配置
   *
   * @returns 所有 Provider 的配置对象
   */
  static getAll(): ProviderConfigSource {
    return this.getLoader().load();
  }

  /**
   * 获取单个 Provider 配置
   *
   * @param providerId Provider ID
   * @returns Provider 配置，如果不存在返回 undefined
   */
  static getProvider(providerId: string) {
    const all = this.getAll();
    return all[providerId];
  }

  /**
   * 获取所有已启用的 Provider
   *
   * @returns 已启用的 Provider 数组
   */
  static getEnabled() {
    const all = this.getAll();
    return Object.values(all).filter((p) => p.enabled);
  }

  /**
   * 获取指定 Provider 的模型列表
   *
   * @param providerId Provider ID
   * @returns 模型列表，如果 Provider 不存在返回空数组
   */
  static getModels(providerId: string) {
    const provider = this.getProvider(providerId);
    return provider?.models || [];
  }

  /**
   * 检查 Provider 是否存在且已启用
   *
   * @param providerId Provider ID
   * @returns 是否存在且已启用
   */
  static isEnabled(providerId: string): boolean {
    const provider = this.getProvider(providerId);
    return provider?.enabled === true;
  }

  /**
   * 加载 Provider 配置（兼容旧代码）
   */
  static load(configDir: string, secretsDir: string): ProviderConfigSource {
    return this.getLoader(configDir, secretsDir).load();
  }

  /**
   * 保存 Provider 配置
   */
  static save(config: ProviderConfigSource, configDir: string, secretsDir: string): void {
    this.getLoader(configDir, secretsDir).save(config);
  }

  /**
   * 清除缓存
   */
  static clearCache(): void {
    if (Providers.loader) {
      Providers.loader.clearCache();
    }
  }
}

class ProviderConfigLoader {
  private configDir: string;
  private configPath: string;
  private secretsPath: string;
  private cache: ProviderConfigSource | null = null;
  private lastLoadTime = 0;
  private watchInterval: NodeJS.Timeout | null = null;

  constructor(configDir: string, secretsDir: string) {
    this.configDir = configDir;
    this.configPath = path.join(configDir, 'providers.json5');
    this.secretsPath = path.join(secretsDir, 'secrets.json5');

    // 确保 providers.json5 文件存在
    this.ensureConfigFile();
  }

  /**
   * 确保 providers.json5 文件存在
   *
   * 如果文件不存在，从默认模板创建。
   */
  private ensureConfigFile(): void {
    if (fs.existsSync(this.configPath)) {
      return;
    }

    // 确保目录存在
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }

    // 从默认模板创建
    try {
      const template = generateDefaultProviders();
      fs.writeFileSync(this.configPath, template, 'utf-8');
      log.info('[Providers] 已创建默认 providers.json5');
    } catch (err) {
      log.error('[Providers] 无法创建默认 providers.json5:', err);
      // 使用最小化回退模板
      const fallback =
        '// AI 模型供应商配置\n{\n  dashscope: {\n    id: "dashscope",\n    name: "百炼",\n    api: "openai-compatible",\n    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",\n    apiKey: "",\n    enabled: false,\n    models: []\n  }\n}\n';
      fs.writeFileSync(this.configPath, fallback, 'utf-8');
    }
  }

  /**
   * 加载 Provider 配置（带缓存）
   */
  load(): ProviderConfigSource {
    // 如果缓存有效，直接返回
    if (this.cache && this.isCacheValid()) {
      return this.cache;
    }

    // 加载配置
    this.cache = this.loadFromFile();
    this.lastLoadTime = Date.now();
    return this.cache;
  }

  /**
   * 从文件加载配置
   */
  private loadFromFile(): ProviderConfigSource {
    // 如果文件不存在，创建默认配置
    if (!fs.existsSync(this.configPath)) {
      log.info('[ProviderConfigLoader] providers.json5 not found, creating default');
      this.createDefaultConfig();
    }

    try {
      const raw = fs.readFileSync(this.configPath, 'utf-8');
      let config = JSON5.parse(raw) as ProviderConfigSource;

      // 合并 secrets 中的 API Keys
      config = this.mergeSecrets(config);

      return config;
    } catch (error) {
      log.error('[ProviderConfigLoader] Failed to load providers.json5:', error);
      return {};
    }
  }

  /**
   * 合并 secrets.json5 中的 API Keys
   */
  private mergeSecrets(config: ProviderConfigSource): ProviderConfigSource {
    if (!fs.existsSync(this.secretsPath)) {
      return config;
    }

    try {
      const raw = fs.readFileSync(this.secretsPath, 'utf-8');
      const secrets = JSON5.parse(raw) as Record<string, string>;

      // 合并 API Keys
      for (const [providerId, apiKey] of Object.entries(secrets)) {
        if (config[providerId] && apiKey) {
          config[providerId].apiKey = apiKey;
        }
      }

      return config;
    } catch (error) {
      log.warn('[ProviderConfigLoader] Failed to load secrets.json5:', error);
      return config;
    }
  }

  /**
   * 创建默认配置文件
   *
   * 从 default-providers.json5 模板读取并写入 providers.json5。
   */
  private createDefaultConfig(): void {
    try {
      const template = generateDefaultProviders();
      fs.writeFileSync(this.configPath, template, 'utf-8');
      log.info('[ProviderConfigLoader] 已创建默认 providers.json5');
    } catch (err) {
      log.error('[ProviderConfigLoader] 无法加载默认模板，使用回退配置:', err);
      // 回退方案：最小化配置
      const defaultConfig: ProviderConfigSource = {
        dashscope: {
          id: 'dashscope',
          name: '百炼',
          description: '阿里云百炼平台，提供企业级AI模型服务',
          api: 'openai-compatible',
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          apiKey: '${DASHSCOPE_API_KEY}',
          enabled: false,
          billingMode: 'pay-as-you-go',
          websites: {
            official: 'https://www.aliyun.com/product/bailian',
            apiKey: 'https://bailian.console.aliyun.com/?tab=model#/api-key',
            docs: 'https://help.aliyun.com/zh/model-studio/getting-started/',
            models: 'https://bailian.console.aliyun.com/?tab=model#/model-market'
          },
          models: [
            {
              id: 'qwen-plus-latest',
              name: 'Qwen Plus',
              contextWindow: 1000000,
              maxInputTokens: 997952,
              maxOutputTokens: 65536,
              reasoning: true,
              features: ['上下文1M', '输出64k', '思考模型', '性价比高']
            }
          ]
        }
      };

      const content = JSON5.stringify(defaultConfig, null, 2);
      fs.writeFileSync(this.configPath, content, 'utf-8');
      log.info('[ProviderConfigLoader] 已使用回退配置创建 providers.json5');
    }
  }

  /**
   * 保存配置
   */
  save(config: ProviderConfigSource): void {
    try {
      const content = JSON5.stringify(config, null, 2);
      fs.writeFileSync(this.configPath, content, 'utf-8');
      this.clearCache();
      log.info('[ProviderConfigLoader] Saved providers.json5');
    } catch (error) {
      log.error('[ProviderConfigLoader] Failed to save providers.json5:', error);
      throw error;
    }
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache = null;
    this.lastLoadTime = 0;
  }

  /**
   * 检查缓存是否有效（5分钟内）
   */
  private isCacheValid(): boolean {
    const now = Date.now();
    const CACHE_TTL = 5 * 60 * 1000; // 5 分钟
    return now - this.lastLoadTime < CACHE_TTL;
  }

  /**
   * 启动文件监听（热重载）
   */
  startWatch(): void {
    if (this.watchInterval) {
      return;
    }

    this.watchInterval = setInterval(() => {
      if (fs.existsSync(this.configPath)) {
        const stats = fs.statSync(this.configPath);
        if (stats.mtimeMs > this.lastLoadTime) {
          log.info('[ProviderConfigLoader] Detected config change, reloading...');
          this.clearCache();
        }
      }
    }, 1000); // 每秒检查一次
  }

  /**
   * 停止文件监听
   */
  stopWatch(): void {
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
    }
  }

  /**
   * 更新 Provider 配置
   *
   * @param providerId Provider ID
   * @param updates 要更新的字段
   */
  updateProvider(providerId: string, updates: Partial<ProviderConfigSource[string]>): void {
    const config = this.load();

    if (!config[providerId]) {
      throw new Error(`Provider "${providerId}" not found`);
    }

    // 合并更新
    config[providerId] = {
      ...config[providerId],
      ...updates,
      id: providerId // 确保 ID 不被覆盖
    };

    this.save(config);
    log.info(`[ProviderConfigLoader] Updated provider: ${providerId}`);
  }

  /**
   * 切换 Provider 启用状态
   *
   * @param providerId Provider ID
   * @param enabled 是否启用
   */
  toggleProvider(providerId: string, enabled: boolean): void {
    this.updateProvider(providerId, { enabled });
    log.info(`[ProviderConfigLoader] Toggled provider "${providerId}": ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * 更新 Provider Base URL
   *
   * @param providerId Provider ID
   * @param baseUrl 新的 Base URL
   */
  updateProviderBaseUrl(providerId: string, baseUrl: string): void {
    this.updateProvider(providerId, { baseUrl });
    log.info(`[ProviderConfigLoader] Updated baseUrl for provider "${providerId}": ${baseUrl}`);
  }
}

// ─────────────────────────────────────────────────────────
// ConfigModule 接口实现（用于自动扫描和加载）
// ─────────────────────────────────────────────────────────

/**
 * Providers 配置模块
 *
 * 实现 ConfigModule 接口，支持自动扫描和生命周期管理
 */
class ProvidersConfigModule implements ConfigModule {
  name = 'providers';
  enabled = true;

  private loader: ProviderConfigLoader | null = null;

  async init(configDir: string, secretsDir: string): Promise<void> {
    log.info(`[${this.name}] 初始化配置模块...`);

    // 创建并缓存 loader
    this.loader = new ProviderConfigLoader(configDir, secretsDir);

    // 加载配置（这会自动创建配置文件如果不存在）
    const config = this.loader.load();
    const providerCount = Object.keys(config).length;
    const enabledCount = Object.values(config).filter((p) => p.enabled).length;

    log.info(`[${this.name}] 配置加载完成: ${providerCount} 个供应商 (${enabledCount} 个已启用)`);

    // 将 loader 设置到 Providers 静态类，保持向后兼容
    Providers['loader'] = this.loader;
  }

  async reload(configDir: string, secretsDir: string): Promise<void> {
    log.info(`[${this.name}] 重载配置...`);

    if (this.loader) {
      this.loader.clearCache();
    }

    await this.init(configDir, secretsDir);
  }

  async cleanup(): Promise<void> {
    log.info(`[${this.name}] 清理资源...`);
    this.loader = null;
    Providers['loader'] = null;
  }
}

/**
 * 导出配置模块实例（供自动扫描使用）
 *
 * 命名规范：必须以 'Module' 结尾
 */
export const ProvidersModule: ConfigModule = new ProvidersConfigModule();
