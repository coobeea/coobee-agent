/**
 * Config Hook — 配置系统初始化
 *
 * 在 READY 阶段初始化：
 *   1. ConfigStore — 统一配置系统（coobee.json5）
 *   2. ConfigWatcher — 配置文件热重载
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

export const ReadyConfigHook: LifecycleHook = {
  name: 'ready-config',
  phase: LifecyclePhase.READY,
  priority: 55,
  critical: false,

  async execute(_context: LifecycleContext): Promise<void> {
    log.info('[ReadyConfigHook] Initializing config system...');

    try {
      // ── ConfigStore 初始化 ──────────────────────────
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

      // 加载配置（ConfigStore 会缓存）
      loader.load();
      log.info(`[ReadyConfigHook] ConfigStore initialized — path: ${loader.configPath}`);

      // 启动配置热重载
      const watcher = new ConfigWatcher(loader);
      watcher.start();
      activeWatcher = watcher;
      log.info('[ReadyConfigHook] ConfigWatcher started');

      log.info('[ReadyConfigHook] Config system initialized successfully');
    } catch (error) {
      log.error('[ReadyConfigHook] Config system initialization failed:', error);
    }
  }
};

/**
 * 退出时停止 ConfigWatcher
 */
export const BeforeQuitConfigHook: LifecycleHook = {
  name: 'before-quit-config',
  phase: LifecyclePhase.BEFORE_QUIT,
  priority: 40,
  critical: false,

  async execute(): Promise<void> {
    if (activeWatcher) {
      activeWatcher.stop();
      activeWatcher = null;
      log.info('[BeforeQuitConfigHook] ConfigWatcher stopped');
    }
  }
};
