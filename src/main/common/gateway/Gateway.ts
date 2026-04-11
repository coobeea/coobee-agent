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
import { scanGatewayBridges, scanGatewayRoutes } from '@main/common/scan';
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

    // 2. 自动发现并注册事件桥接
    this.discoverEventBridges();

    // 3. 自动发现并注册 HTTP 路由
    this.discoverHttpRoutes();

    // 4. 启动网络层
    this.server.start();

    this.initialized = true;
    log.info('[Gateway] Started');
  }

  /**
   * 自动发现并注册事件桥接
   *
   * 扫描 @main/gateway/bridges/*Bridge.ts 文件
   * 查找导出的 EventBridgeInit 函数并执行初始化
   */
  private discoverEventBridges(): void {
    const modules = scanGatewayBridges();

    let registeredCount = 0;

    for (const { path: filePath, module } of modules) {
      for (const [exportName, exportValue] of Object.entries(module)) {
        // 查找所有以 'init' 开头的函数导出（约定：EventBridge 初始化函数）
        if (typeof exportValue === 'function' && exportName.startsWith('init')) {
          try {
            const cleanup = (exportValue as EventBridgeInit)(this);
            if (cleanup) {
              this.eventBridgeCleanups.push(cleanup);
            }
            log.debug(`[Gateway] 初始化事件桥接: ${exportName} (来自 ${filePath})`);
            registeredCount++;
          } catch (error) {
            log.error(`[Gateway] 事件桥接初始化失败: ${exportName}`, error);
          }
        }
      }
    }

    log.info(`[Gateway] 事件桥接发现完成: 共 ${registeredCount} 个`);
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
