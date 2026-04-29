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

import type { WebSocket } from 'ws';
import { log } from '@main/common/logger';
import { eventBus } from '@main/common/eventbus';
import { scanGatewayPublishers, scanGatewayRoutes, scanRpcMethods } from '@main/common/scan';
import { GatewayServer } from './GatewayServer';
import { GatewayErrorCode, GatewayMethodError } from './errors';
import type {
  GatewayApi,
  GatewayRequest,
  GatewayResponse,
  GatewayOutMessage,
  EventBridgeInit,
  RouteRegistrar,
  ClientMeta,
  ClientPredicate,
  MethodHandler,
  MethodGroup
} from './types';

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
  private methods = new Map<string, MethodHandler>();
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

    // 设置消息处理回调
    this.server.onMessage = (ws, data, meta) => {
      this.handleMessage(ws, data, meta).catch((error) => {
        log.error('[Gateway] Error handling message:', error);
      });
    };

    this.server.onConnect = (_ws, meta) => {
      log.debug(`[Gateway] Client connected: ${meta.connectionId}`);
    };

    this.server.onDisconnect = (_ws, meta) => {
      log.debug(`[Gateway] Client disconnected: ${meta.connectionId}`);
    };

    // 2. 自动发现并注册 RPC 方法
    this.discoverMethods();

    // 3. 注册内置方法
    this.registerBuiltinMethods();

    // 4. 自动发现并注册事件推送配置
    this.discoverEventPublishers();

    // 5. 自动发现并注册 HTTP 路由
    this.discoverHttpRoutes();

    // 6. 启动网络层
    this.server.start();

    this.initialized = true;
    log.info(`[Gateway] Started with ${this.methods.size} method(s)`);
  }

  // ==================== 方法发现和注册 ====================

  /**
   * 自动发现并注册 RPC 方法
   *
   * 扫描 @main/rpc/*Methods.ts 文件
   */
  private discoverMethods(): void {
    const modules = scanRpcMethods();

    for (const { path: filePath, module } of modules) {
      for (const [exportName, exportValue] of Object.entries(module)) {
        if (this.isMethodGroup(exportValue)) {
          this.registerMethods(exportValue as MethodGroup);
          log.debug(`[Gateway] 发现方法组: ${exportName} (来自 ${filePath})`);
        }
      }
    }

    log.info(`[Gateway] 方法发现完成: ${this.methods.size} 个方法 [${[...this.methods.keys()].join(', ')}]`);
  }

  /**
   * 类型守卫：判断导出值是否为 MethodGroup
   */
  private isMethodGroup(value: unknown): value is MethodGroup {
    if (!value || typeof value !== 'object') return false;
    const obj = value as Record<string, unknown>;
    return typeof obj.namespace === 'string' && typeof obj.methods === 'object' && obj.methods !== null;
  }

  /**
   * 注册方法组（展开为 'namespace.action' 格式）
   */
  registerMethods(group: MethodGroup): void {
    group.onInit?.(this);
    for (const [action, handler] of Object.entries(group.methods)) {
      const fullName = `${group.namespace}.${action}`;
      if (this.methods.has(fullName)) {
        log.warn(`[Gateway] 方法名冲突，覆盖已有: ${fullName}`);
      }
      this.methods.set(fullName, handler);
    }
    log.info(`[Gateway] 注册方法组: ${group.namespace} (${Object.keys(group.methods).length} 个方法)`);
  }

  /**
   * 注册内置方法
   */
  private registerBuiltinMethods(): void {
    // system.methods — 返回所有已注册方法名
    this.methods.set('system.methods', async () => {
      return { methods: [...this.methods.keys()] };
    });

    // system.health — 健康检查
    this.methods.set('system.health', async () => {
      return {
        status: 'ok',
        clients: this.clientCount,
        methods: this.methods.size
      };
    });

    log.debug('[Gateway] Built-in methods registered');
  }

  // ==================== 消息路由 ====================

  /**
   * 处理客户端消息
   */
  private async handleMessage(ws: WebSocket, data: string, meta: ClientMeta): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      this.sendError(ws, '', GatewayErrorCode.PARSE_ERROR, 'Failed to parse JSON');
      return;
    }

    if (!parsed || typeof parsed !== 'object') {
      this.sendError(ws, '', GatewayErrorCode.INVALID_MESSAGE, 'Invalid message format');
      return;
    }

    const msg = parsed as Record<string, unknown>;

    if (msg.type === 'req') {
      await this.handleRequest(ws, msg as unknown as GatewayRequest, meta);
    } else {
      this.sendError(
        ws,
        (msg.id as string) || '',
        GatewayErrorCode.UNKNOWN_MESSAGE_TYPE,
        `Unknown message type: ${String(msg.type)}`
      );
    }
  }

  /**
   * 处理 RPC 请求
   */
  private async handleRequest(ws: WebSocket, req: GatewayRequest, meta: ClientMeta): Promise<void> {
    // 校验请求格式
    if (!req.id || !req.method) {
      this.sendError(ws, req.id || '', GatewayErrorCode.INVALID_MESSAGE, 'Missing id or method');
      return;
    }

    // 查找 handler
    const handler = this.methods.get(req.method);
    if (!handler) {
      this.sendError(ws, req.id, GatewayErrorCode.METHOD_NOT_FOUND, `Method not found: ${req.method}`);
      return;
    }

    // 执行 handler
    try {
      const result = await handler(req.params ?? {}, {
        clientId: meta.connectionId,
        ws,
        meta,
        gateway: this
      });

      const response: GatewayResponse = {
        type: 'res',
        id: req.id,
        ok: true,
        payload: result
      };
      this.server?.send(ws, response);
    } catch (error) {
      // 结构化错误处理
      if (error instanceof GatewayMethodError) {
        this.sendError(ws, req.id, error.code, error.message);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`[Gateway] Method ${req.method} error:`, error);
        this.sendError(ws, req.id, GatewayErrorCode.INTERNAL_ERROR, message);
      }
    }
  }

  /**
   * 发送错误响应
   */
  private sendError(ws: WebSocket, requestId: string, code: GatewayErrorCode, message?: string): void {
    const response: GatewayResponse = {
      type: 'res',
      id: requestId,
      ok: false,
      error: {
        code,
        message: message ?? `Error ${code}`
      }
    };
    this.server?.send(ws, response);
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
            (exportValue as RouteRegistrar)(router, this.server);
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

  send(ws: WebSocket, payload: GatewayOutMessage): void {
    this.server?.send(ws, payload);
  }

  broadcastEvent(event: string, payload: unknown): void {
    if (!this.server) return;

    const msg = {
      type: 'event' as const,
      event,
      payload,
      timestamp: Date.now()
    };

    this.server.broadcast(msg);
  }

  broadcastEventIf(event: string, payload: unknown, predicate: ClientPredicate): number {
    if (!this.server) return 0;

    const msg = {
      type: 'event' as const,
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
