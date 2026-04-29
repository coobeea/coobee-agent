/**
 * Gateway 统一网络层
 *
 * 职责：
 *   - HTTP：创建并管理 Koa App + http.Server（统一端口）
 *   - WebSocket：创建 WebSocketServer，挂载到 http.Server
 *   - Router：创建 Gateway Router，挂载到 Koa App
 *
 * 整合了原 HttpServer 和 GatewayServer 的功能，提供统一的网络层管理。
 */

import type { Server as NodeHttpServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import http from 'node:http';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { is } from '@electron-toolkit/utils';
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import cors from '@koa/cors';
import KoaStatic from 'koa-static';
import { WebSocketServer, WebSocket } from 'ws';
import Router from '@koa/router';
import { log } from '@main/common/logger';
import { Env } from '@main/common/env';
import type { ClientMeta, GatewayOutMessage, ClientPredicate, WebSocketUpgradeHandler } from './types';

let connectionIdCounter = 0;

function generateConnectionId(): string {
  connectionIdCounter++;
  return `gw-${Date.now()}-${connectionIdCounter}`;
}

/** GatewayServer 消息处理回调 */
export type GatewayMessageHandler = (ws: WebSocket, data: string, meta: ClientMeta) => void | Promise<void>;

/** GatewayServer 连接事件回调 */
export type GatewayConnectionHandler = (ws: WebSocket, meta: ClientMeta) => void;

export class GatewayServer {
  private static instance: GatewayServer | null = null;

  private app: Koa = new Koa();
  private nodeHttpServer!: NodeHttpServer;
  private wss!: WebSocketServer;
  private router: Router = new Router({ prefix: '/gateway' });
  private clients = new Map<WebSocket, ClientMeta>();
  private wsUpgradeHandlers: Array<{ prefix: string; handler: WebSocketUpgradeHandler }> = [];
  private initialized = false;
  private heartbeatInterval = 30000; // 30秒
  private serverPort: number = Env.main.serverPort ? parseInt(Env.main.serverPort, 10) : 8765;
  private serverHost: string = Env.main.serverHost || '127.0.0.1';

  // RPC 消息处理回调
  public onMessage?: GatewayMessageHandler;
  public onConnect?: GatewayConnectionHandler;
  public onDisconnect?: GatewayConnectionHandler;

  constructor() {
    if (GatewayServer.instance) {
      log.warn('[GatewayServer] Instance already exists, returning existing instance');
      return GatewayServer.instance;
    }

    // 配置中间件
    this.setupMiddleware();

    GatewayServer.instance = this;
    log.info('[GatewayServer] Instance created');
  }

  /**
   * 获取单例
   */
  static getInstance(): GatewayServer | null {
    return GatewayServer.instance;
  }

  /**
   * 配置 Koa 中间件
   */
  private setupMiddleware(): void {
    // CORS 支持
    this.app.use(cors({ origin: '*' }));

    // 请求体解析
    this.app.use(bodyParser());

    // 静态文件服务
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      // 开发模式：反向代理到 Vite dev server
      const viteUrl = new URL(process.env['ELECTRON_RENDERER_URL']);
      this.app.use(this.createDevProxy(viteUrl.hostname, parseInt(viteUrl.port, 10)));
      log.info(`[GatewayServer] Dev proxy → ${process.env['ELECTRON_RENDERER_URL']}`);
    } else {
      // 生产模式：直接服务构建产物
      const staticPath = path.join(__dirname, '../renderer');
      this.app.use(KoaStatic(staticPath, { index: 'index.html', maxAge: 0, gzip: true }));
      log.info(`[GatewayServer] Static files → ${staticPath}`);
    }

    log.debug('[GatewayServer] Middleware configured');
  }

  /**
   * 轻量反向代理中间件（开发模式专用）
   */
  private createDevProxy(host: string, port: number): Koa.Middleware {
    return async (ctx, next) => {
      // 已被其他中间件/路由处理的请求跳过
      if (ctx.respond === false || ctx.body != null) {
        await next();
        return;
      }

      // Gateway/API 路由不代理
      const p = ctx.path;
      if (p.startsWith('/gateway/') || p.startsWith('/api/')) {
        await next();
        return;
      }

      await new Promise<void>((resolve, reject) => {
        const proxyReq = http.request(
          {
            hostname: host,
            port,
            path: ctx.url,
            method: ctx.method,
            headers: { ...ctx.headers, host: `${host}:${port}` }
          },
          (proxyRes) => {
            ctx.status = proxyRes.statusCode || 502;
            const resHeaders = proxyRes.headers;
            for (const [key, val] of Object.entries(resHeaders)) {
              if (val != null) ctx.set(key, val as string);
            }
            ctx.body = proxyRes;
            resolve();
          }
        );
        proxyReq.on('error', (err) => {
          log.debug(`[GatewayServer] Dev proxy error: ${err.message}`);
          reject(err);
        });
        if (ctx.req.readable) {
          ctx.req.pipe(proxyReq);
        } else {
          proxyReq.end();
        }
      }).catch(async () => {
        await next();
      });
    };
  }

  /**
   * 启动 GatewayServer
   *
   * 1. 创建 http.Server 并监听端口
   * 2. 创建 WebSocketServer，挂载到 http.Server
   * 3. 注册内置 HTTP 端点
   * 4. 将 Router 挂载到 Koa app
   */
  start(): void {
    if (this.initialized) {
      log.warn('[GatewayServer] Already started');
      return;
    }

    // 1. 创建 http.Server 并监听端口
    this.app.on('error', (err, ctx) => {
      log.error('[GatewayServer] Koa error:', err, ctx);
    });

    this.nodeHttpServer = http.createServer(this.app.callback());

    this.nodeHttpServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        log.error(
          `[GatewayServer] 端口 ${this.serverPort} 已被占用，请关闭占用该端口的程序或更改 VITE_SERVER_PORT 配置`
        );
      } else {
        log.error('[GatewayServer] HTTP Server error:', err);
      }
    });

    this.nodeHttpServer.listen(this.serverPort, this.serverHost, () => {
      log.info(
        `[GatewayServer] HTTP Server listening on http://${this.serverHost}:${this.serverPort} (HTTP + WebSocket)`
      );
      if (this.serverHost === '0.0.0.0') {
        log.info('[GatewayServer] 局域网 Web 访问已开启，外部浏览器可通过本机 IP 访问');
      }
    });

    // 2. WebSocket 层：手动分发 upgrade，支持 /gateway/ws 和业务 WebSocket 代理共存
    this.wss = new WebSocketServer({ noServer: true });
    this.nodeHttpServer.on('upgrade', (req, socket, head) => {
      this.handleUpgrade(req, socket, head);
    });

    // 3. HTTP 层：注册内置端点
    this.registerBuiltinRoutes();

    // 4. 将 Router 挂载到 Koa app
    this.app.use(this.router.routes()).use(this.router.allowedMethods());

    this.initialized = true;
    log.info('[GatewayServer] Started (HTTP: port, WS: /gateway/ws, HTTP: /gateway/*)');
  }

  /**
   * 关闭 GatewayServer
   */
  close(): Promise<void> {
    return new Promise((resolve) => {
      // 停止心跳并关闭所有 WebSocket 客户端
      for (const [ws, meta] of this.clients) {
        if (meta.heartbeatTimer) clearInterval(meta.heartbeatTimer);
        ws.terminate();
      }
      this.clients.clear();

      // 关闭 WebSocket Server
      if (this.wss) {
        this.wss.close(() => {
          log.info('[GatewayServer] WebSocket Server closed');
        });
      }

      // 关闭 HTTP Server
      if (this.nodeHttpServer) {
        this.nodeHttpServer.close(() => {
          this.initialized = false;
          GatewayServer.instance = null;
          log.info('[GatewayServer] HTTP Server closed');
          resolve();
        });
      } else {
        this.initialized = false;
        GatewayServer.instance = null;
        resolve();
      }
    });
  }

  /**
   * 获取 Koa App（供外部中间件注册使用，如有需要）
   */
  getApp(): Koa {
    return this.app;
  }

  /**
   * 获取 http.Server（供外部使用，如有需要）
   */
  getHttpServer(): NodeHttpServer {
    return this.nodeHttpServer;
  }

  // ==================== WebSocket 通信 ====================

  /**
   * 向单个客户端发送消息
   */
  send(ws: WebSocket, payload: GatewayOutMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(payload));
      } catch (error) {
        log.warn('[GatewayServer] Send failed:', error);
      }
    }
  }

  /**
   * 向所有客户端广播事件
   */
  broadcast(payload: GatewayOutMessage): void {
    const msg = JSON.stringify(payload);
    let sentCount = 0;

    for (const [ws] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(msg);
          sentCount++;
        } catch (error) {
          log.warn('[GatewayServer] Broadcast failed:', error);
        }
      }
    }

    const eventName = 'type' in payload && payload.type === 'event' ? payload.event : 'unknown';
    log.debug(`[GatewayServer] Broadcast: ${eventName} -> ${sentCount} clients`);
  }

  /**
   * 按条件广播事件
   */
  broadcastIf(payload: GatewayOutMessage, predicate: ClientPredicate): number {
    const msg = JSON.stringify(payload);
    let count = 0;

    for (const [ws, meta] of this.clients) {
      if (ws.readyState === WebSocket.OPEN && predicate(meta)) {
        try {
          ws.send(msg);
          count++;
        } catch (error) {
          log.warn('[GatewayServer] Broadcast (filtered) failed:', error);
        }
      }
    }

    const eventName = 'type' in payload && payload.type === 'event' ? payload.event : 'unknown';
    log.debug(`[GatewayServer] Broadcast (filtered): ${eventName} -> ${count} clients`);
    return count;
  }

  /**
   * 遍历所有客户端
   */
  forEachClient(callback: (ws: WebSocket, meta: ClientMeta) => void): void {
    for (const [ws, meta] of this.clients) {
      callback(ws, meta);
    }
  }

  /**
   * 获取客户端元数据
   */
  getClientMeta(ws: WebSocket): ClientMeta | undefined {
    return this.clients.get(ws);
  }

  /**
   * 客户端数量
   */
  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * 是否已启动
   */
  get isStarted(): boolean {
    return this.initialized;
  }

  /**
   * 获取 Gateway HTTP Router（供外部注册额外路由）
   */
  getRouter(): Router {
    return this.router;
  }

  /**
   * 注册额外 WebSocket upgrade 处理器。
   *
   * prefix 使用完整路径，如 /gateway/workers/。
   */
  registerWebSocketUpgrade(prefix: string, handler: WebSocketUpgradeHandler): () => void {
    const item = { prefix, handler };
    this.wsUpgradeHandlers.push(item);

    // 更长 prefix 优先，避免宽泛前缀抢先匹配
    this.wsUpgradeHandlers.sort((a, b) => b.prefix.length - a.prefix.length);

    return () => {
      const index = this.wsUpgradeHandlers.indexOf(item);
      if (index >= 0) {
        this.wsUpgradeHandlers.splice(index, 1);
      }
    };
  }

  // ==================== 私有方法 ====================

  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const pathname = this.getUpgradePathname(req);

    if (pathname === '/gateway/ws') {
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.attachGatewayClient(ws);
      });
      return;
    }

    for (const { prefix, handler } of this.wsUpgradeHandlers) {
      if (!pathname.startsWith(prefix)) continue;
      const handled = handler(req, socket, head, pathname);
      if (handled) return;
    }

    this.rejectUpgrade(socket, 404, 'WebSocket route not found');
  }

  private getUpgradePathname(req: IncomingMessage): string {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      return url.pathname;
    } catch {
      return '/';
    }
  }

  private rejectUpgrade(socket: Duplex, statusCode: number, reason: string): void {
    try {
      socket.write(`HTTP/1.1 ${statusCode} ${reason}\r\nConnection: close\r\n\r\n`);
    } catch {
      // ignore write error
    }
    socket.destroy();
  }

  private attachGatewayClient(ws: WebSocket): void {
    const meta: ClientMeta = {
      connectionId: generateConnectionId(),
      connectedAt: Date.now(),
      isAlive: true,
      heartbeatTimer: null
    };
    this.clients.set(ws, meta);
    this.startHeartbeat(ws, meta);

    log.info(`[GatewayServer] Client connected: ${meta.connectionId} (total: ${this.clients.size})`);

    // 调用连接回调
    this.onConnect?.(ws, meta);

    ws.on('pong', () => {
      meta.isAlive = true;
    });

    // 处理客户端消息
    ws.on('message', (data: Buffer) => {
      try {
        this.onMessage?.(ws, data.toString(), meta);
      } catch (error) {
        log.error('[GatewayServer] Error handling message:', error);
      }
    });

    ws.on('close', () => {
      this.onDisconnect?.(ws, meta);
      this.cleanupClient(ws);
      log.info(`[GatewayServer] Client disconnected: ${meta.connectionId} (total: ${this.clients.size})`);
    });

    ws.on('error', (error) => {
      log.error(`[GatewayServer] Client error (${meta.connectionId}):`, error);
      this.onDisconnect?.(ws, meta);
      this.cleanupClient(ws);
    });
  }

  /**
   * 注册内置 HTTP 端点
   */
  private registerBuiltinRoutes(): void {
    const startTime = Date.now();

    // GET /gateway/health — 健康检查
    this.router.get('/health', (ctx) => {
      ctx.body = {
        status: 'ok',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        clients: this.clients.size
      };
    });

    log.debug('[GatewayServer] Built-in HTTP routes registered');
  }

  /**
   * 启动心跳检测
   */
  private startHeartbeat(ws: WebSocket, meta: ClientMeta): void {
    meta.heartbeatTimer = setInterval(() => {
      if (!meta.isAlive) {
        log.info(`[GatewayServer] Heartbeat timeout: ${meta.connectionId}`);
        ws.terminate();
        this.cleanupClient(ws);
        return;
      }
      meta.isAlive = false;
      ws.ping();
    }, this.heartbeatInterval);
  }

  /**
   * 清理客户端连接
   */
  private cleanupClient(ws: WebSocket): void {
    const meta = this.clients.get(ws);
    if (meta?.heartbeatTimer) {
      clearInterval(meta.heartbeatTimer);
      meta.heartbeatTimer = null;
    }
    this.clients.delete(ws);
  }
}
