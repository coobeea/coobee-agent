# Gateway 自动扫描架构设计方案

> 日期：2026-04-11  
> 版本：v3.0（自动扫描版）  
> 状态：设计方案

## 📋 核心思路

**问题**：v2.0 简化版需要手动在 `setupEventListeners()` 中注册事件，导致通用层频繁修改。

**解决方案**：借鉴 coobee-ai Gateway 的自动扫描机制，**业务层通过文件约定自动注册**。

---

## 1. coobee-ai Gateway 自动扫描机制分析

### 1.1 扫描函数（scan.ts）

```typescript
// src/main/common/scan.ts

/**
 * 扫描 Gateway 方法组文件
 * 扫描 @main/gateway/methods 目录下所有 *.ts 文件
 */
export function scanGatewayMethods(): DiscoveredModule[] {
  const modules = import.meta.glob('@main/gateway/methods/**/*.ts', { eager: true });
  const filteredModules = filterModules(modules, ['__tests__']);
  return filteredModules;
}

/**
 * 扫描 Gateway 事件桥接文件
 * 扫描 @main/gateway/events 目录下所有 *.ts 文件
 */
export function scanGatewayEventBridges(): DiscoveredModule[] {
  const modules = import.meta.glob('@main/gateway/events/**/*.ts', { eager: true });
  const filteredModules = filterModules(modules, ['__tests__']);
  return filteredModules;
}
```

**关键技术**：
- `import.meta.glob()` - Vite 提供的模块批量导入功能
- `{ eager: true }` - 立即加载所有模块（同步）
- `filterModules()` - 过滤掉测试文件

### 1.2 Gateway 自动发现与注册

```typescript
// src/main/gateway/Gateway.ts

export class Gateway {
  start(): void {
    // 1. 自动发现方法组
    this.discoverMethods();
    
    // 2. 自动发现事件桥接
    this.discoverEventBridges();
    
    // 3. 启动网络层
    this.server.start();
  }

  private discoverMethods(): void {
    const modules = scanGatewayMethods();

    for (const { path: filePath, module } of modules) {
      for (const [exportName, exportValue] of Object.entries(module)) {
        if (this.isMethodGroup(exportValue)) {
          this.registerMethods(exportValue as MethodGroup);
        }
      }
    }
  }

  private discoverEventBridges(): void {
    const modules = scanGatewayEventBridges();

    for (const { path: filePath, module } of modules) {
      for (const [exportName, exportValue] of Object.entries(module)) {
        if (typeof exportValue === 'function') {
          const cleanup = exportValue(this);  // 执行初始化函数
          if (cleanup) {
            this.eventBridgeCleanups.push(cleanup);
          }
        }
      }
    }
  }
}
```

**流程**：
1. `scanGatewayMethods()` / `scanGatewayEventBridges()` 扫描文件
2. 遍历每个模块的所有导出
3. 识别符合约定的导出（MethodGroup / EventBridgeInit 函数）
4. 自动注册

---

## 2. 文件约定与接口定义

### 2.1 EventBridge 约定（WebSocket 事件推送）

**文件位置**：`src/main/gateway/bridges/*Bridge.ts`

**命名规范**：
- 文件名以 `Bridge.ts` 结尾
- 例如：`StreamBridge.ts`、`WorkerBridge.ts`

**导出约定**：
- 导出一个初始化函数（`EventBridgeInit` 类型）
- 函数接收 `gateway` 参数
- 返回清理函数（用于移除 EventBus 监听器）

**示例**：
```typescript
// src/main/gateway/bridges/StreamBridge.ts

import { eventBus } from '@main/common/eventbus';
import { log } from '@main/common/logger';
import type { EventBridgeInit } from '@main/gateway/types';

/**
 * Stream 事件桥接
 * 监听 EventBus 的 stream:* 事件，转发到 WebSocket
 */
export const initStreamBridge: EventBridgeInit = (gateway) => {
  const handleStreamMessage = (data: { sessionId: string; message: string }): void => {
    gateway.broadcastEvent('stream:message', data);
  };

  const handleStreamStart = (data: { sessionId: string }): void => {
    gateway.broadcastEvent('stream:start', data);
  };

  const handleStreamEnd = (data: { sessionId: string }): void => {
    gateway.broadcastEvent('stream:end', data);
  };

  // 注册 EventBus 监听器
  eventBus.on('stream:message', handleStreamMessage);
  eventBus.on('stream:start', handleStreamStart);
  eventBus.on('stream:end', handleStreamEnd);

  log.info('[StreamBridge] 事件桥接初始化完成');

  // 返回清理函数
  return () => {
    eventBus.off('stream:message', handleStreamMessage);
    eventBus.off('stream:start', handleStreamStart);
    eventBus.off('stream:end', handleStreamEnd);
    log.info('[StreamBridge] 事件桥接已清理');
  };
};
```

---

### 2.2 HTTP Routes 约定（可选）

**文件位置**：`src/main/gateway/routes/*Routes.ts`

**命名规范**：
- 文件名以 `Routes.ts` 结尾
- 例如：`AgentRoutes.ts`、`ThreadRoutes.ts`

**导出约定**：
- 导出一个注册函数
- 函数接收 `router` 参数（Koa Router）

**示例**：
```typescript
// src/main/gateway/routes/AgentRoutes.ts

import type Router from '@koa/router';
import { log } from '@main/common/logger';

/**
 * Agent HTTP 路由
 */
export function registerAgentRoutes(router: Router): void {
  // GET /gateway/agents - 获取所有 Agent
  router.get('/agents', async (ctx) => {
    // 业务逻辑
    ctx.body = { agents: [] };
  });

  // POST /gateway/agents - 创建 Agent
  router.post('/agents', async (ctx) => {
    // 业务逻辑
    ctx.body = { success: true };
  });

  log.info('[AgentRoutes] HTTP 路由注册完成');
}
```

---

## 3. 最终架构设计

### 3.1 目录结构

```
src/main/
├── common/
│   └── scan.ts                        # 扫描工具（新增扫描函数）
│
├── gateway/                           # Gateway 通用层
│   ├── Gateway.ts                     # 核心类（自动扫描 + 注册）
│   ├── GatewayServer.ts               # 网络层（WebSocket + HTTP）
│   ├── types.ts                       # 类型定义
│   ├── index.ts                       # 导出
│   │
│   ├── bridges/                       # 业务层：WebSocket 事件桥接
│   │   ├── StreamBridge.ts           # Stream 事件桥接
│   │   ├── WorkerBridge.ts           # Worker 事件桥接
│   │   ├── AgentBridge.ts            # Agent 事件桥接
│   │   └── ...
│   │
│   └── routes/                        # 业务层：HTTP REST 路由（可选）
│       ├── AgentRoutes.ts            # Agent 路由
│       ├── ThreadRoutes.ts           # Thread 路由
│       └── ...
│
└── lifecycle/
    └── ReadyGatewayHook.ts           # Gateway 初始化 Hook
```

---

### 3.2 核心组件

#### A. scan.ts（新增扫描函数）

```typescript
// src/main/common/scan.ts

/**
 * 扫描 Gateway 事件桥接文件
 * 扫描 @main/gateway/bridges 目录下所有 *Bridge.ts 文件
 */
export function scanGatewayBridges(): DiscoveredModule[] {
  log.info('[Scan] 开始扫描 Gateway 事件桥接文件...');

  const modules = import.meta.glob('@main/gateway/bridges/**/*Bridge.ts', { eager: true });
  const totalFound = Object.keys(modules).length;

  const filteredModules = filterModules(modules, ['__tests__']);
  const filteredCount = filteredModules.length;

  log.info(`[Scan] Gateway 事件桥接扫描完成: 发现 ${totalFound} 个文件，过滤后剩余 ${filteredCount} 个`);

  return filteredModules;
}

/**
 * 扫描 Gateway HTTP 路由文件
 * 扫描 @main/gateway/routes 目录下所有 *Routes.ts 文件
 */
export function scanGatewayRoutes(): DiscoveredModule[] {
  log.info('[Scan] 开始扫描 Gateway HTTP 路由文件...');

  const modules = import.meta.glob('@main/gateway/routes/**/*Routes.ts', { eager: true });
  const totalFound = Object.keys(modules).length;

  const filteredModules = filterModules(modules, ['__tests__']);
  const filteredCount = filteredModules.length;

  log.info(`[Scan] Gateway HTTP 路由扫描完成: 发现 ${totalFound} 个文件，过滤后剩余 ${filteredCount} 个`);

  return filteredModules;
}
```

---

#### B. types.ts（类型定义）

```typescript
// src/main/gateway/types.ts

import type { WebSocket } from 'ws';
import type Router from '@koa/router';

/**
 * 客户端元数据
 */
export interface ClientMeta {
  connectionId: string;
  connectedAt: number;
  isAlive: boolean;
  heartbeatTimer: NodeJS.Timeout | null;
}

/**
 * WebSocket 事件消息
 */
export interface GatewayEvent {
  type: 'event';
  event: string;
  payload: unknown;
  timestamp: number;
}

/**
 * Gateway API（供 EventBridge 调用）
 */
export interface GatewayApi {
  /** 向所有客户端广播事件 */
  broadcastEvent(event: string, payload: unknown): void;
  
  /** 按条件广播事件 */
  broadcastEventIf(event: string, payload: unknown, predicate: (meta: ClientMeta) => boolean): number;
  
  /** 遍历所有客户端 */
  forEachClient(callback: (ws: WebSocket, meta: ClientMeta) => void): void;
  
  /** 客户端数量 */
  readonly clientCount: number;
}

/**
 * EventBridge 初始化函数签名
 * 
 * @param gateway Gateway 实例
 * @returns 清理函数（用于移除 EventBus 监听器）
 */
export type EventBridgeInit = (gateway: GatewayApi) => (() => void) | void;

/**
 * HTTP 路由注册函数签名
 * 
 * @param router Koa Router 实例
 */
export type RouteRegistrar = (router: Router) => void;
```

---

#### C. GatewayServer.ts（网络层）

**直接复用 coobee-ai 的 GatewayServer 代码**，核心功能：
- WebSocket 服务器管理
- 客户端连接管理
- 心跳检测
- HTTP Router 管理

```typescript
// src/main/gateway/GatewayServer.ts

import type { Server as NodeHttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import Router from '@koa/router';
import { log } from '@main/common/logger';
import type { HttpServer } from '@main/common/server/httpServer';
import type { ClientMeta, GatewayEvent } from './types';

export class GatewayServer {
  private wss!: WebSocketServer;
  private router: Router;
  private clients = new Map<WebSocket, ClientMeta>();
  private initialized = false;
  private nodeHttpServer: NodeHttpServer;
  private heartbeatInterval = 30000;

  constructor(httpServer: HttpServer) {
    this.nodeHttpServer = httpServer.getHttpServer();
    this.router = new Router({ prefix: '/gateway' });
  }

  /**
   * 启动 GatewayServer
   */
  start(): void {
    if (this.initialized) return;

    // 1. 创建 WebSocketServer
    this.wss = new WebSocketServer({
      server: this.nodeHttpServer,
      path: '/gateway/ws'
    });

    this.wss.on('connection', (ws) => {
      const meta: ClientMeta = {
        connectionId: this.generateConnectionId(),
        connectedAt: Date.now(),
        isAlive: true,
        heartbeatTimer: null
      };
      this.clients.set(ws, meta);
      this.startHeartbeat(ws, meta);

      log.info(`[GatewayServer] Client connected: ${meta.connectionId} (total: ${this.clients.size})`);

      ws.on('pong', () => {
        meta.isAlive = true;
      });

      ws.on('close', () => {
        this.cleanupClient(ws);
        log.info(`[GatewayServer] Client disconnected: ${meta.connectionId} (total: ${this.clients.size})`);
      });

      ws.on('error', (error) => {
        log.error(`[GatewayServer] Client error (${meta.connectionId}):`, error);
        this.cleanupClient(ws);
      });
    });

    // 2. 注册内置 HTTP 端点
    this.registerBuiltinRoutes();

    // 3. 将 Router 挂到 Koa app
    const app = httpServer.getApp();
    app.use(this.router.routes()).use(this.router.allowedMethods());

    this.initialized = true;
    log.info('[GatewayServer] Started (WS: /gateway/ws, HTTP: /gateway/*)');
  }

  /**
   * 向所有客户端广播事件
   */
  broadcast(payload: GatewayEvent): void {
    const msg = JSON.stringify(payload);
    for (const [ws] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  }

  /**
   * 按条件广播事件
   */
  broadcastIf(payload: GatewayEvent, predicate: (meta: ClientMeta) => boolean): number {
    const msg = JSON.stringify(payload);
    let count = 0;
    for (const [ws, meta] of this.clients) {
      if (ws.readyState === WebSocket.OPEN && predicate(meta)) {
        ws.send(msg);
        count++;
      }
    }
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
   * 获取 Router（供外部注册 HTTP 路由）
   */
  getRouter(): Router {
    return this.router;
  }

  /**
   * 客户端数量
   */
  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * 关闭服务器
   */
  close(): Promise<void> {
    return new Promise((resolve) => {
      for (const [ws, meta] of this.clients) {
        if (meta.heartbeatTimer) clearInterval(meta.heartbeatTimer);
        ws.terminate();
      }
      this.clients.clear();

      if (this.wss) {
        this.wss.close(() => {
          this.initialized = false;
          log.info('[GatewayServer] Closed');
          resolve();
        });
      } else {
        this.initialized = false;
        resolve();
      }
    });
  }

  // ==================== 私有方法 ====================

  private connectionIdCounter = 0;
  private generateConnectionId(): string {
    this.connectionIdCounter++;
    return `gw-${Date.now()}-${this.connectionIdCounter}`;
  }

  private registerBuiltinRoutes(): void {
    const startTime = Date.now();

    this.router.get('/health', (ctx) => {
      ctx.body = {
        status: 'ok',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        clients: this.clients.size
      };
    });

    log.debug('[GatewayServer] Built-in HTTP routes registered');
  }

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

  private cleanupClient(ws: WebSocket): void {
    const meta = this.clients.get(ws);
    if (meta?.heartbeatTimer) {
      clearInterval(meta.heartbeatTimer);
      meta.heartbeatTimer = null;
    }
    this.clients.delete(ws);
  }
}
```

---

#### D. Gateway.ts（核心编排类）

```typescript
// src/main/gateway/Gateway.ts

import { log } from '@main/common/logger';
import { HttpServer } from '@main/common/server/httpServer';
import { scanGatewayBridges, scanGatewayRoutes } from '@main/common/scan';
import { GatewayServer } from './GatewayServer';
import type { GatewayApi, EventBridgeInit, RouteRegistrar, GatewayEvent, ClientMeta } from './types';
import type { WebSocket } from 'ws';

/**
 * Gateway 核心编排
 * 
 * 职责：
 * 1. 管理 GatewayServer（WebSocket + HTTP）
 * 2. 自动扫描并注册事件桥接（bridges/*Bridge.ts）
 * 3. 自动扫描并注册 HTTP 路由（routes/*Routes.ts）
 * 4. 提供事件广播 API 供业务层调用
 */
export class Gateway implements GatewayApi {
  private server: GatewayServer | null = null;
  private eventBridgeCleanups: Array<() => void> = [];

  /**
   * 启动 Gateway
   */
  start(): void {
    if (this.server) {
      log.warn('[Gateway] Already started');
      return;
    }

    const httpServer = HttpServer.getInstance();
    if (!httpServer) {
      log.error('[Gateway] HttpServer not initialized');
      return;
    }

    // 1. 创建 GatewayServer
    this.server = new GatewayServer(httpServer);

    // 2. 自动发现并注册事件桥接
    this.discoverEventBridges();

    // 3. 自动发现并注册 HTTP 路由
    this.discoverHttpRoutes();

    // 4. 启动网络层
    this.server.start();

    log.info('[Gateway] Started');
  }

  /**
   * 自动发现并注册事件桥接
   */
  private discoverEventBridges(): void {
    const modules = scanGatewayBridges();

    for (const { path: filePath, module } of modules) {
      for (const [exportName, exportValue] of Object.entries(module)) {
        if (typeof exportValue === 'function') {
          try {
            const cleanup = (exportValue as EventBridgeInit)(this);
            if (cleanup) {
              this.eventBridgeCleanups.push(cleanup);
            }
            log.debug(`[Gateway] 初始化事件桥接: ${exportName} (来自 ${filePath})`);
          } catch (error) {
            log.error(`[Gateway] 事件桥接初始化失败: ${exportName}`, error);
          }
        }
      }
    }

    log.info(`[Gateway] 事件桥接发现完成: 共 ${this.eventBridgeCleanups.length} 个`);
  }

  /**
   * 自动发现并注册 HTTP 路由
   */
  private discoverHttpRoutes(): void {
    if (!this.server) return;

    const modules = scanGatewayRoutes();
    const router = this.server.getRouter();

    for (const { path: filePath, module } of modules) {
      for (const [exportName, exportValue] of Object.entries(module)) {
        if (typeof exportValue === 'function' && exportName.startsWith('register')) {
          try {
            (exportValue as RouteRegistrar)(router);
            log.debug(`[Gateway] 注册 HTTP 路由: ${exportName} (来自 ${filePath})`);
          } catch (error) {
            log.error(`[Gateway] HTTP 路由注册失败: ${exportName}`, error);
          }
        }
      }
    }

    log.info(`[Gateway] HTTP 路由发现完成`);
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

  broadcastEventIf(event: string, payload: unknown, predicate: (meta: ClientMeta) => boolean): number {
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

  /**
   * 关闭 Gateway
   */
  async close(): Promise<void> {
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
    
    log.info('[Gateway] Closed');
  }
}

// 导出单例
export const gateway = new Gateway();
```

---

#### E. ReadyGatewayHook.ts（生命周期 Hook）

```typescript
// src/main/lifecycle/ReadyGatewayHook.ts

import { LifecyclePhase, LifecycleContext, LifecycleHook } from '@main/common/types';
import { log } from '@main/common/logger';

export const ReadyGatewayHook: LifecycleHook = {
  name: 'ready-gateway',
  phase: LifecyclePhase.READY,
  priority: 100,  // 在 HttpServer 初始化后（优先级 50）
  critical: false,

  async execute(_context: LifecycleContext): Promise<void> {
    log.info('[ReadyGatewayHook] 启动 Gateway...');

    try {
      const { gateway } = await import('@main/gateway');
      
      // 启动 Gateway（自动扫描并注册）
      gateway.start();

      log.info('[ReadyGatewayHook] Gateway 启动完成');
    } catch (error) {
      log.error('[ReadyGatewayHook] Gateway 启动失败:', error);
      // 不抛出错误，允许应用继续运行
    }
  }
};
```

---

## 4. 使用示例

### 4.1 新增业务事件推送

**需求**：添加 Worker 状态推送

**步骤**：

1. **创建 EventBridge 文件**

```typescript
// src/main/gateway/bridges/WorkerBridge.ts

import { eventBus } from '@main/common/eventbus';
import { log } from '@main/common/logger';
import type { EventBridgeInit } from '@main/gateway/types';

export const initWorkerBridge: EventBridgeInit = (gateway) => {
  const handleWorkerStatus = (data: { workerId: string; status: string }): void => {
    gateway.broadcastEvent('worker:status', data);
  };

  const handleWorkerProgress = (data: { workerId: string; progress: number }): void => {
    gateway.broadcastEvent('worker:progress', data);
  };

  eventBus.on('worker:status', handleWorkerStatus);
  eventBus.on('worker:progress', handleWorkerProgress);

  log.info('[WorkerBridge] 事件桥接初始化完成');

  return () => {
    eventBus.off('worker:status', handleWorkerStatus);
    eventBus.off('worker:progress', handleWorkerProgress);
    log.info('[WorkerBridge] 事件桥接已清理');
  };
};
```

2. **业务代码触发事件**

```typescript
// src/main/common/worker/WorkerManager.ts

import { eventBus } from '@main/common/eventbus';

export class WorkerManager {
  async startWorker(workerId: string): Promise<void> {
    // ... 启动逻辑 ...
    
    // 触发事件
    eventBus.emit('worker:status', { workerId, status: 'running' });
  }
}
```

**完成！** Gateway 会自动扫描并注册 `WorkerBridge.ts`，无需修改任何通用层代码。

---

### 4.2 新增 HTTP REST 路由

**需求**：添加 Thread 管理接口

**步骤**：

1. **创建 Routes 文件**

```typescript
// src/main/gateway/routes/ThreadRoutes.ts

import type Router from '@koa/router';
import { log } from '@main/common/logger';

export function registerThreadRoutes(router: Router): void {
  // GET /gateway/threads - 获取所有 Thread
  router.get('/threads', async (ctx) => {
    // 业务逻辑
    ctx.body = { threads: [] };
  });

  // POST /gateway/threads - 创建 Thread
  router.post('/threads', async (ctx) => {
    const { title, agentId } = ctx.request.body;
    // 业务逻辑
    ctx.body = { success: true, threadId: '123' };
  });

  // DELETE /gateway/threads/:id - 删除 Thread
  router.delete('/threads/:id', async (ctx) => {
    const { id } = ctx.params;
    // 业务逻辑
    ctx.body = { success: true };
  });

  log.info('[ThreadRoutes] HTTP 路由注册完成');
}
```

**完成！** Gateway 会自动扫描并注册这些路由。

---

## 5. 架构对比

### 5.1 版本演进

| 特性 | v1.0（复杂版） | v2.0（简化版） | v3.0（自动扫描版）✅ |
|-----|---------------|---------------|-------------------|
| **事件注册** | 独立 EventBridge 文件 + 自动扫描 | 手动在 `setupEventListeners()` | **自动扫描 bridges/**✅ |
| **HTTP 路由** | 独立 Routes 文件 + 手动注册 | - | **自动扫描 routes/**✅ |
| **通用层修改** | 不需要 | **需要（添加 registerListener）** | **不需要**✅ |
| **文件约定** | 有 | 无 | **有（清晰）**✅ |
| **代码复用** | 自己实现 | 复用 GatewayServer | **复用 coobee-ai Gateway**✅ |

### 5.2 与 coobee-ai Gateway 的对比

| 特性 | coobee-ai Gateway | 本方案（v3.0） |
|-----|-------------------|---------------|
| **核心架构** | Gateway + GatewayServer | **相同**✅ |
| **自动扫描** | methods/ + events/ | **bridges/ + routes/**（更清晰） |
| **RPC 支持** | 有（methods/） | 无（业务层按需实现） |
| **复杂度** | ⭐⭐⭐⭐ | **⭐⭐⭐**（去掉 RPC 层） |
| **通用性** | ⭐⭐⭐ | **⭐⭐⭐⭐**（更纯粹） |

---

## 6. 核心优势

### 6.1 自动扫描的优势

✅ **通用层不需要修改**
- 新增业务事件推送：只需创建 `bridges/*Bridge.ts` 文件
- 新增 HTTP 路由：只需创建 `routes/*Routes.ts` 文件
- Gateway 自动发现并注册

✅ **文件约定清晰**
- `*Bridge.ts` - EventBridge
- `*Routes.ts` - HTTP Routes
- 一看文件名就知道是什么

✅ **易于维护**
- 业务逻辑按模块分散在不同文件
- 不会出现一个 `setupEventListeners()` 方法有 100 行的情况

✅ **支持热插拔**
- 删除 Bridge 文件 → 停止推送
- 添加 Bridge 文件 → 自动推送

### 6.2 与手动注册的对比

**v2.0 手动注册**：
```typescript
// 每次新增事件都要修改这里
private setupEventListeners(): void {
  this.registerListener('stream:message');
  this.registerListener('stream:start');
  this.registerListener('worker:status');
  this.registerListener('worker:progress');
  this.registerListener('agent:message');
  // ... 100 行 ...
}
```
❌ 通用层频繁修改  
❌ 代码臃肿  
❌ 不清楚哪个事件属于哪个业务

**v3.0 自动扫描**：
```typescript
// 创建 bridges/WorkerBridge.ts
export const initWorkerBridge: EventBridgeInit = (gateway) => {
  // 只关注 Worker 相关事件
  eventBus.on('worker:status', ...);
  eventBus.on('worker:progress', ...);
};
```
✅ 通用层不修改  
✅ 代码清晰  
✅ 业务逻辑内聚

---

## 7. 实施清单

### Phase 1: 复用 coobee-ai Gateway 核心代码

- [ ] 复制 `GatewayServer.ts` 到 `src/main/gateway/`
- [ ] 复制 `Gateway.ts` 并简化（去掉 RPC 方法路由）
- [ ] 定义 `types.ts`（ClientMeta, GatewayEvent, EventBridgeInit, RouteRegistrar）

### Phase 2: 实现自动扫描

- [ ] 在 `src/main/common/scan.ts` 中添加：
  - `scanGatewayBridges()` - 扫描 `bridges/*Bridge.ts`
  - `scanGatewayRoutes()` - 扫描 `routes/*Routes.ts`
- [ ] 在 `Gateway.ts` 中实现：
  - `discoverEventBridges()` - 自动注册
  - `discoverHttpRoutes()` - 自动注册

### Phase 3: 创建示例 Bridge

- [ ] `src/main/gateway/bridges/StreamBridge.ts`
- [ ] `src/main/gateway/bridges/WorkerBridge.ts`

### Phase 4: 生命周期集成

- [ ] 创建 `ReadyGatewayHook.ts`
- [ ] 在 Hook 中调用 `gateway.start()`

### Phase 5: 前端集成（可选）

- [ ] `src/renderer/src/utils/websocket.ts`（WebSocketClient）
- [ ] 在 Pinia store 中监听事件

---

## 8. 总结

### 8.1 核心设计理念

**通用层（Gateway）**：
- 只负责 WebSocket 连接管理、HTTP 路由管理、自动扫描机制
- 不包含任何业务逻辑
- 不需要修改（除非添加新的扫描类型）

**业务层（bridges/ + routes/）**：
- 通过文件约定自动注册
- 每个文件只关注自己的业务领域
- 可以随意增删，不影响通用层

### 8.2 关键对比

| 方案 | 通用层修改频率 | 代码行数 | 文件约定 | 自动扫描 |
|-----|--------------|---------|---------|---------|
| v1.0 | 低 | 500+ 行 | 有 | ✅ |
| v2.0 | **高** | 225 行 | 无 | ❌ |
| v3.0 | **无** | 300 行 | 有 | ✅ |

### 8.3 最终推荐

**推荐方案：v3.0（自动扫描版）**

**理由**：
1. ✅ 完全复用 coobee-ai Gateway 的优点（自动扫描）
2. ✅ 去掉了 coobee-ai Gateway 的缺点（RPC 方法路由业务混杂）
3. ✅ 通用层不需要修改，业务层只需创建文件
4. ✅ 文件约定清晰，易于理解和维护

**与 v2.0 对比**：
- v2.0 更简单（只有 3 个文件），但需要手动注册
- v3.0 稍复杂（5 个核心文件），但自动扫描，更易扩展

**对于您的需求**，v3.0 完美符合：
- ✅ 通用层（Gateway）不包含业务逻辑
- ✅ 业务层（bridges/）自动扫描
- ✅ 类似 `events/*Changed.ts` 的自动发现机制

---

**您觉得这个方案如何？** 🎉
