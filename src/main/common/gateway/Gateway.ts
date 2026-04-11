/**
 * Gateway 核心编排
 *
 * 职责：
 * 1. 管理 GatewayServer（WebSocket + HTTP）
 * 2. 自动扫描并注册事件桥接（bridges/*Bridge.ts）
 * 3. 自动扫描并注册 HTTP 路由（routes/*Routes.ts）
 * 4. 提供事件广播 API 供业务层调用
 *
 * 设计理念：
 *   - 通用层：不包含任何业务逻辑
 *   - 业务层：通过文件约定自动注册
 *   - 类似 IpcEventBroadcaster 的简洁模式
 */

import { log } from '@main/common/logger';
import { eventBus } from '@main/common/eventbus';
import { scanGatewayPublishers, scanGatewayRoutes } from '@main/common/scan';
import { GatewayServer } from './GatewayServer';
import type { GatewayApi, EventBridgeInit, RouteRegistrar, GatewayEvent, ClientMeta, ClientPredicate } from './types';
import type { WebSocket } from 'ws';

/**
 * Gateway 核心类
 *
 * 统一的网络层入口，一次性完成：
 *   1. HTTP Server（Koa + http.Server）
 *   2. WebSocket Server（挂载到 http.Server）
 *   3. 自动扫描并注册 bridges/ 和 routes/
 */
export class Gateway implements GatewayApi {
  private server: GatewayServer | null = null;
  private eventBridgeCleanups: Array<() => void> = [];
  private initialized = false;

  /**
   * 启动 Gateway
   *
   * 一次性完成整个网络层的初始化，无需外部分步调用。
   */
  start(): void {
    if (this.initialized) {
      log.warn('[Gateway] Already started');
      return;
    }

    log.info('[Gateway] 初始化统一网络层...');

    // 1. 创建 GatewayServer（统一管理 HTTP + WebSocket）
    this.server = new GatewayServer();

    // 2. 自动发现并注册事件推送配置
    this.discoverEventPublishers();

    // 3. 自动发现并注册 HTTP 路由
    this.discoverHttpRoutes();

    // 4. 启动网络层
    this.server.start();

    this.initialized = true;
    log.info('[Gateway] Started');
  }

  /**
   * 自动发现并注册事件推送配置
   *
   * 扫描 @main/publishers/*Publisher.ts 文件
   * 支持三种配置格式：
   *   1. 数组：['event1', 'event2'] - 事件名相同，直接转发
   *   2. 对象：{ 'event1': 'targetEvent1', 'event2': true } - 支持改名
   *   3. 函数：EventBridgeInit - 兼容复杂场景
   */
  private discoverEventPublishers(): void {
    const modules = scanGatewayPublishers();

    let registeredCount = 0;

    for (const { path: filePath, module } of modules) {
      try {
        // 方案 1：数组形式（最简）
        if (module.default && Array.isArray(module.default)) {
          const events = module.default as string[];
          this.registerArrayPublisher(events, filePath);
          registeredCount++;
          continue;
        }

        // 方案 2：对象形式（支持改名和转换）
        if (module.default && typeof module.default === 'object' && !Array.isArray(module.default)) {
          const config = module.default as Record<string, unknown>;
          this.registerObjectPublisher(config, filePath);
          registeredCount++;
          continue;
        }

        // 方案 3：函数形式（兼容复杂场景）
        for (const [exportName, exportValue] of Object.entries(module)) {
          if (typeof exportValue === 'function' && exportName.startsWith('init')) {
            const cleanup = (exportValue as EventBridgeInit)(this);
            if (cleanup) {
              this.eventBridgeCleanups.push(cleanup);
            }
            log.debug(`[Gateway] 初始化事件推送（函数）: ${exportName} (来自 ${filePath})`);
            registeredCount++;
          }
        }
      } catch (error) {
        log.error(`[Gateway] 事件推送配置加载失败: ${filePath}`, error);
      }
    }

    log.info(`[Gateway] 事件推送配置发现完成: 共 ${registeredCount} 个`);
  }

  /**
   * 注册数组形式的推送配置
   * 示例：export default ['event1', 'event2']
   */
  private registerArrayPublisher(events: string[], filePath: string): void {
    const handlers: Array<() => void> = [];

    for (const eventName of events) {
      const handler = (data: unknown): void => {
        this.broadcastEvent(eventName, data);
      };

      eventBus.on(eventName, handler);
      handlers.push(() => eventBus.off(eventName, handler));
    }

    this.eventBridgeCleanups.push(() => {
      handlers.forEach((cleanup) => cleanup());
    });

    log.debug(`[Gateway] 注册推送配置（数组）: ${filePath} (${events.length} 个事件)`);
  }

  /**
   * 注册对象形式的推送配置
   * 示例：export default { 'event1': 'targetEvent1', 'event2': true }
   */
  private registerObjectPublisher(config: Record<string, unknown>, filePath: string): void {
    const handlers: Array<() => void> = [];

    for (const [busEvent, target] of Object.entries(config)) {
      const handler = (data: unknown): void => {
        if (typeof target === 'function') {
          // 支持数据转换函数
          const transformed = target(data);
          this.broadcastEvent(busEvent, transformed);
        } else if (typeof target === 'string') {
          // 支持改名
          this.broadcastEvent(target, data);
        } else {
          // 直接转发（target === true）
          this.broadcastEvent(busEvent, data);
        }
      };

      eventBus.on(busEvent, handler);
      handlers.push(() => eventBus.off(busEvent, handler));
    }

    this.eventBridgeCleanups.push(() => {
      handlers.forEach((cleanup) => cleanup());
    });

    log.debug(`[Gateway] 注册推送配置（对象）: ${filePath} (${Object.keys(config).length} 个事件)`);
  }

  /**
   * 自动发现并注册 HTTP 路由
   *
   * 扫描 @main/gateway/routes/*Routes.ts 文件
   * 查找导出的 RouteRegistrar 函数并调用注册
   */
  private discoverHttpRoutes(): void {
    if (!this.server) return;

    const modules = scanGatewayRoutes();
    const router = this.server.getRouter();

    let registeredCount = 0;

    for (const { path: filePath, module } of modules) {
      for (const [exportName, exportValue] of Object.entries(module)) {
        // 查找所有以 'register' 开头的函数导出（约定：路由注册函数）
        if (typeof exportValue === 'function' && exportName.startsWith('register')) {
          try {
            (exportValue as RouteRegistrar)(router);
            log.debug(`[Gateway] 注册 HTTP 路由: ${exportName} (来自 ${filePath})`);
            registeredCount++;
          } catch (error) {
            log.error(`[Gateway] HTTP 路由注册失败: ${exportName}`, error);
          }
        }
      }
    }

    log.info(`[Gateway] HTTP 路由发现完成: 共 ${registeredCount} 个`);
  }

  // ==================== GatewayApi 实现 ====================

  broadcastEvent(event: string, payload: unknown): void {
    if (!this.server) return;

    const msg: GatewayEvent = {
      type: 'event',
      event,
      payload,
      timestamp: Date.now()
    };

    this.server.broadcast(msg);
  }

  broadcastEventIf(event: string, payload: unknown, predicate: ClientPredicate): number {
    if (!this.server) return 0;

    const msg: GatewayEvent = {
      type: 'event',
      event,
      payload,
      timestamp: Date.now()
    };

    return this.server.broadcastIf(msg, predicate);
  }

  forEachClient(callback: (ws: WebSocket, meta: ClientMeta) => void): void {
    this.server?.forEachClient(callback);
  }

  get clientCount(): number {
    return this.server?.clientCount ?? 0;
  }

  // ==================== 生命周期 ====================

  /**
   * 检查 Gateway 是否已启动
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 检查 Gateway 是否已启动且运行正常
   */
  isReady(): boolean {
    return this.initialized && this.server !== null && this.server.isStarted;
  }

  /**
   * 关闭 Gateway
   */
  async close(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    // 清理所有 EventBridge 监听器
    for (const cleanup of this.eventBridgeCleanups) {
      try {
        cleanup();
      } catch (error) {
        log.error('[Gateway] EventBridge cleanup failed:', error);
      }
    }
    this.eventBridgeCleanups = [];

    // 关闭 GatewayServer
    await this.server?.close();
    this.server = null;
    this.initialized = false;

    log.info('[Gateway] Closed');
  }
}

// 导出单例
export const gateway = new Gateway();
