/**
 * Config Hook — 配置系统初始化
 *
 * 在 READY 阶段初始化：
 *   1. ConfigStore — 统一配置系统（coobee.json5 + secrets.json5）
 *   2. ConfigModules — 自动扫描并初始化所有配置模块（providers, agents, skills 等）
 *   3. ConfigWatcher — 配置文件热重载
 *   4. ProviderSystem — Provider 注册表和模型选择器
 *
 * 执行顺序：
 *   ReadyExtensionHook (50) → ReadyConfigHook (55)
 *
 * 前置条件：Extension 系统已初始化（钩子依赖 ExtensionManager）
 */

import { LifecyclePhase, type LifecycleContext, type LifecycleHook } from '@main/common/types';
import { log } from '@main/common/logger';

/** 模块级引用，供退出时停止 */
let activeWatcher: { stop(): void } | null = null;
let activeConfigManager: InstanceType<typeof import('@main/common/scan').ConfigModuleManager> | null = null;

export const ReadyConfigHook: LifecycleHook = {
  name: 'ready-config',
  phase: LifecyclePhase.READY,
  priority: 55,
  critical: false,

  async execute(_context: LifecycleContext): Promise<void> {
    log.info('[ReadyConfigHook] Initializing config system...');

    try {
      // ── Step 1: ConfigStore（主配置文件：coobee.json5）──────────────────────────
      const { Env } = await import('@main/common/env');
      const { ConfigLoader } = await import('@main/common/config/ConfigLoader');
      const { ConfigStore, setConfigStoreInstance } = await import('@main/common/config/ConfigStore');
      const { ConfigWatcher } = await import('@main/common/config/ConfigWatcher');

      const configDir = Env.paths.configDir;
      const secretsDir = Env.paths.secretsDir;
      const loader = new ConfigLoader(configDir, secretsDir);

      // 确保配置文件存在
      loader.ensureConfigFile();

      const store = new ConfigStore(loader);
      setConfigStoreInstance(store);

      // 立即加载配置到缓存（确保启动时配置可用）
      loader.load();
      log.info(`[ReadyConfigHook] ConfigStore initialized — path: ${loader.configPath}`);

      // ── Step 2: ConfigModules（自动扫描配置模块：providers, agents, skills 等）──────
      const { ConfigModuleManager } = await import('@main/common/scan');
      const configManager = new ConfigModuleManager();

      // 扫描所有配置模块
      configManager.scan();
      log.info(`[ReadyConfigHook] ConfigModules discovered: ${configManager.enabledCount} modules`);

      // 初始化所有配置模块
      await configManager.initAll(configDir, secretsDir);

      // 保存管理器引用（用于热重载和清理）
      activeConfigManager = configManager;

      // ── Step 3: ConfigWatcher（配置文件热重载）────────────────────────
      const watcher = new ConfigWatcher(loader);
      watcher.onReload(async (_plan) => {
        // 重载主配置（loader.clearCache() 会在 ConfigWatcher 内部自动调用）
        log.info(`[ReadyConfigHook] Main config reloaded`);

        // 重载所有配置模块
        if (activeConfigManager) {
          await activeConfigManager.reloadAll(configDir, secretsDir);
        }
      });

      watcher.start();
      activeWatcher = watcher;
      log.info('[ReadyConfigHook] ConfigWatcher started — hot-reload enabled');

      // ✅ 配置系统初始化完成
      // 需要使用配置的模块可以直接 import 使用：
      //   - ConfigStore: 主配置（coobee.json5）
      //   - Providers: Provider 配置（providers.json5）
      //   - Models: 统一的模型解析服务（连接主配置和 Providers）
      //
      // 使用示例：
      //   import { Models } from '@main/config';
      //   const { provider, model } = Models.resolveModel(agent.model);

      log.info('[ReadyConfigHook] Config system initialized successfully');
    } catch (error) {
      log.error('[ReadyConfigHook] Config system initialization failed:', error);
    }
  }
};

/**
 * 退出时停止 ConfigWatcher 和清理配置模块
 */
export const BeforeQuitConfigHook: LifecycleHook = {
  name: 'before-quit-config',
  phase: LifecyclePhase.BEFORE_QUIT,
  priority: 40,
  critical: false,

  async execute(): Promise<void> {
    // 清理配置模块
    if (activeConfigManager) {
      await activeConfigManager.cleanupAll();
      activeConfigManager = null;
      log.info('[BeforeQuitConfigHook] ConfigModules cleaned up');
    }

    // 停止配置监听器
    if (activeWatcher) {
      activeWatcher.stop();
      activeWatcher = null;
      log.info('[BeforeQuitConfigHook] ConfigWatcher stopped');
    }
  }
};
