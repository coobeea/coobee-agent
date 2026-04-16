import { log } from './logger';
import { DiscoveredModule } from './types';
import type { ConfigModule } from '@main/config/types';

/**
 * 模块扫描工具
 *
 * 提供统一的自动扫描机制，支持：
 * - 生命周期 Hooks
 * - 事件处理器
 * - Gateway Publishers（WebSocket 推送配置）
 * - Gateway Routes（HTTP 路由）
 * - 配置模块（Config Modules）
 */

/**
 * 扫描生命周期 Hook 文件
 * 扫描 @main/lifecycle 目录下所有 *Hook.ts 文件
 */
export function scanLifeCycleHooks(): DiscoveredModule[] {
  log.info('[Scan] 开始扫描生命周期Hook文件...');

  const modules = import.meta.glob('@main/lifecycle/**/*Hook.ts', { eager: true });
  const totalFound = Object.keys(modules).length;

  const filteredModules = filterModules(modules, ['BaseHook', '__tests__']);
  const filteredCount = filteredModules.length;

  log.info(`[Scan] 生命周期Hook扫描完成: 发现 ${totalFound} 个文件，过滤后剩余 ${filteredCount} 个`);

  return filteredModules;
}

/**
 * 扫描事件处理器文件
 * 扫描 @main/events 目录下所有 *Changed.ts 文件
 *
 * 事件命名规范：
 * - 文件名以 Changed.ts 结尾（如 themeChanged.ts）
 * - 必须默认导出一个处理函数
 * - 文件名会自动转换为事件名（themeChanged → config:theme:changed）
 */
export function scanEventHandlers(): DiscoveredModule[] {
  log.info('[Scan] 开始扫描事件处理器文件...');

  const modules = import.meta.glob('@main/events/**/*Changed.ts', { eager: true });
  const totalFound = Object.keys(modules).length;

  // 过滤掉 README.md 等非事件文件
  const filteredModules = filterModules(modules, ['README', '__tests__']);
  const filteredCount = filteredModules.length;

  log.info(`[Scan] 事件处理器文件扫描完成: 发现 ${totalFound} 个文件，过滤后剩余 ${filteredCount} 个`);

  return filteredModules;
}

/**
 * 扫描 Gateway 事件推送配置文件
 * 扫描 @main/publishers 目录下所有 *Publisher.ts 文件
 *
 * 推送配置命名规范：
 * - 文件名以 Publisher.ts 结尾（如 StreamPublisher.ts）
 * - 必须 export default 一个配置（数组或对象形式）
 */
export function scanGatewayPublishers(): DiscoveredModule[] {
  log.info('[Scan] 开始扫描 Gateway 事件推送配置文件...');

  const modules = import.meta.glob('@main/publishers/**/*Publisher.ts', { eager: true });
  const totalFound = Object.keys(modules).length;

  const filteredModules = filterModules(modules, ['__tests__']);
  const filteredCount = filteredModules.length;

  log.info(`[Scan] Gateway 事件推送配置扫描完成: 发现 ${totalFound} 个文件，过滤后剩余 ${filteredCount} 个`);

  return filteredModules;
}

/**
 * 扫描 Gateway HTTP 路由文件
 * 扫描 @main/routes 目录下所有 *Routes.ts 文件
 *
 * 路由命名规范：
 * - 文件名以 Routes.ts 结尾（如 AgentRoutes.ts）
 * - 必须导出 RouteRegistrar 类型的函数（函数名以 'register' 开头）
 */
export function scanGatewayRoutes(): DiscoveredModule[] {
  log.info('[Scan] 开始扫描 Gateway HTTP 路由文件...');

  const modules = import.meta.glob('@main/routes/**/*Routes.ts', { eager: true });
  const totalFound = Object.keys(modules).length;

  const filteredModules = filterModules(modules, ['__tests__']);
  const filteredCount = filteredModules.length;

  log.info(`[Scan] Gateway HTTP 路由扫描完成: 发现 ${totalFound} 个文件，过滤后剩余 ${filteredCount} 个`);

  return filteredModules;
}

/**
 * 通用过滤函数 - 过滤掉指定的文件
 *
 * @param modules 扫描结果对象 (使用 eager: true 时，值直接是模块内容)
 * @param excludePatterns 要排除的文件名模式数组
 * @returns 过滤后的模块数组
 */
export function filterModules(modules: Record<string, unknown>, excludePatterns: string[] = []): DiscoveredModule[] {
  const filteredModules: DiscoveredModule[] = [];

  for (const [modulePath, moduleContent] of Object.entries(modules)) {
    // 检查是否应该排除这个文件
    const shouldExclude = excludePatterns.some((excludePattern) => modulePath.includes(excludePattern));

    if (!shouldExclude) {
      // 当使用 eager: true 时，moduleContent 直接就是模块内容，不是函数
      filteredModules.push({
        path: modulePath,
        module: moduleContent as Record<string, unknown>
      });
    }
  }

  return filteredModules;
}

// ─────────────────────────────────────────────────────────
// 配置模块扫描（Config Modules）
// ─────────────────────────────────────────────────────────

/**
 * 扫描配置模块
 *
 * 自动发现 @main/config 目录下实现了 ConfigModule 接口的模块。
 *
 * 命名规范：
 * - 文件名：*.ts
 * - 导出变量名：必须以 'Module' 结尾（如 ProvidersModule）
 * - 必须实现 ConfigModule 接口
 *
 * 排除的文件：
 * - index.ts（导出入口）
 * - types.ts（类型定义）
 * - default-template.ts（模板生成）
 * - __tests__（测试文件）
 */
export function scanConfigModules(): ConfigModule[] {
  log.info('[Scan] 开始扫描配置模块...');

  const modules = import.meta.glob('@main/config/*.ts', { eager: true });
  const totalFound = Object.keys(modules).length;
  const discovered: ConfigModule[] = [];

  for (const [modulePath, moduleContent] of Object.entries(modules)) {
    // 跳过特殊文件
    if (
      modulePath.includes('index.ts') ||
      modulePath.includes('types.ts') ||
      modulePath.includes('default-template.ts') ||
      modulePath.includes('__tests__')
    ) {
      continue;
    }

    const mod = moduleContent as Record<string, unknown>;

    // 查找导出的 ConfigModule 实例（变量名以 Module 结尾）
    for (const [key, value] of Object.entries(mod)) {
      if (key.endsWith('Module') && isConfigModule(value)) {
        discovered.push(value);
        log.info(`[Scan] 发现配置模块: ${value.name} <- ${modulePath}`);
      }
    }
  }

  log.info(`[Scan] 配置模块扫描完成: 发现 ${totalFound} 个文件，识别出 ${discovered.length} 个配置模块`);
  return discovered;
}

/**
 * 类型守卫：检查对象是否实现了 ConfigModule 接口
 */
function isConfigModule(obj: unknown): obj is ConfigModule {
  if (typeof obj !== 'object' || obj === null) return false;

  const module = obj as Partial<ConfigModule>;
  return (
    typeof module.name === 'string' &&
    (module.init === undefined || typeof module.init === 'function') &&
    (module.reload === undefined || typeof module.reload === 'function') &&
    (module.cleanup === undefined || typeof module.cleanup === 'function')
  );
}

/**
 * 配置模块管理器
 *
 * 负责配置模块的生命周期管理：扫描、初始化、重载、清理
 */
export class ConfigModuleManager {
  private modules: ConfigModule[] = [];

  /** 扫描并注册所有配置模块 */
  scan(): void {
    this.modules = scanConfigModules();
  }

  /** 初始化所有配置模块 */
  async initAll(configDir: string, secretsDir: string): Promise<void> {
    log.info('[ConfigModuleManager] 初始化配置模块...');

    for (const module of this.modules) {
      if (module.enabled === false) {
        log.info(`[ConfigModuleManager] 跳过禁用的模块: ${module.name}`);
        continue;
      }

      if (module.init) {
        try {
          await module.init(configDir, secretsDir);
          log.info(`[ConfigModuleManager] ✅ ${module.name} 初始化成功`);
        } catch (error) {
          log.error(`[ConfigModuleManager] ❌ ${module.name} 初始化失败:`, error);
        }
      }
    }

    log.info('[ConfigModuleManager] 配置模块初始化完成');
  }

  /** 重载所有配置模块 */
  async reloadAll(configDir: string, secretsDir: string): Promise<void> {
    log.info('[ConfigModuleManager] 重载配置模块...');

    for (const module of this.modules) {
      if (module.reload && module.enabled !== false) {
        try {
          await module.reload(configDir, secretsDir);
          log.info(`[ConfigModuleManager] ✅ ${module.name} 重载成功`);
        } catch (error) {
          log.error(`[ConfigModuleManager] ❌ ${module.name} 重载失败:`, error);
        }
      }
    }

    log.info('[ConfigModuleManager] 配置模块重载完成');
  }

  /** 清理所有配置模块 */
  async cleanupAll(): Promise<void> {
    log.info('[ConfigModuleManager] 清理配置模块...');

    for (const module of this.modules) {
      if (module.cleanup) {
        try {
          await module.cleanup();
          log.info(`[ConfigModuleManager] ✅ ${module.name} 清理成功`);
        } catch (error) {
          log.error(`[ConfigModuleManager] ❌ ${module.name} 清理失败:`, error);
        }
      }
    }
  }

  /** 获取所有模块 */
  getAll(): ConfigModule[] {
    return this.modules;
  }

  /** 根据名称获取模块 */
  get(name: string): ConfigModule | undefined {
    return this.modules.find((m) => m.name === name);
  }

  /** 获取已启用的模块数量 */
  get enabledCount(): number {
    return this.modules.filter((m) => m.enabled !== false).length;
  }
}
