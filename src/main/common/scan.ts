import { log } from './logger';
import { DiscoveredModule } from './types';

/**
 * 模块扫描工具
 *
 * 提供统一的自动扫描机制，支持：
 * - 生命周期 Hooks
 * - 事件处理器
 * - Gateway Publishers（WebSocket 推送配置）
 * - Gateway Routes（HTTP 路由）
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
