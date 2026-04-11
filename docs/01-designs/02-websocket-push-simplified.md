# WebSocket 业务事件推送架构设计方案（简化版）

> ⚠️ **注意**：本方案已被 [03-gateway-auto-scan-design.md](03-gateway-auto-scan-design.md) 替代，保留作为历史参考。

> 日期：2026-04-11  
> 版本：v2.0（简化版）  
> 状态：⚠️ 已废弃

## 📋 核心思路

**对标 IpcEventBroadcaster 的简洁模式**：
- 业务逻辑 → EventBus（emit 事件）
- WebSocketEventBroadcaster → 监听 EventBus → WebSocket 推送
- 就这么简单！

---

## 1. 现有架构对比

### 1.1 IpcEventBroadcaster（已有，用于 Electron IPC）

```typescript
class IpcEventBroadcaster {
  init(): void {
    this.setupEventListeners();  // 注册固定的事件监听
  }

  private setupEventListeners(): void {
    // 注册所有需要推送的事件
    this.registerListener(EventTypes.WINDOW_CREATED);
    this.registerListener(EventTypes.TAB_ACTIVATED);
    this.registerListener(EventTypes.BACKEND_READY);
    // ...
  }

  private registerListener(eventType): void {
    const handler = (data) => {
      this.broadcast(eventType, data);  // 转发到渲染进程
    };
    eventBus.on(eventType, handler);  // 监听 EventBus
  }

  broadcast(type, payload): void {
    webContents.send('ipc:event', { type, payload });
  }
}
```

**流程**：
```
业务代码
  ↓ eventBus.emit('window:created')
EventBus
  ↓ 触发监听器
IpcEventBroadcaster
  ↓ webContents.send()
渲染进程
```

---

### 1.2 WebSocketEventBroadcaster（要实现的，用于 WebSocket）

**完全对标 IpcEventBroadcaster 的模式**：

```typescript
class WebSocketEventBroadcaster {
  private wss: WebSocketServer;
  private clients = new Map<WebSocket, ClientMeta>();

  init(httpServer: HttpServer): void {
    // 1. 启动 WebSocket 服务器
    this.startWebSocketServer(httpServer);
    
    // 2. 注册固定的事件监听
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // 注册所有需要通过 WebSocket 推送的业务事件
    this.registerListener('stream:message');
    this.registerListener('stream:start');
    this.registerListener('stream:end');
    this.registerListener('worker:status');
    this.registerListener('agent:message');
    // ...
  }

  private registerListener(eventType: string): void {
    const handler = (data) => {
      this.broadcast(eventType, data);  // 转发到 WebSocket 客户端
    };
    eventBus.on(eventType, handler);  // 监听 EventBus
  }

  broadcast(event: string, payload: unknown): void {
    const msg = JSON.stringify({ type: 'event', event, payload });
    for (const [ws] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  }
}
```

**流程**：
```
业务代码
  ↓ eventBus.emit('stream:message')
EventBus
  ↓ 触发监听器
WebSocketEventBroadcaster
  ↓ ws.send()
WebSocket 客户端（前端/移动端）
```

---

## 2. coobee-ai Gateway 通用性分析

### 2.1 Gateway 架构拆解

**coobee-ai Gateway 包含**：

```
Gateway.ts
  ├─ GatewayServer (网络层)  ✅ 通用
  │   ├─ WebSocketServer
  │   ├─ HTTP Router
  │   ├─ 心跳检测
  │   └─ 客户端管理
  │
  ├─ RPC 方法路由  ⚠️ 机制通用，具体方法是业务
  │   └─ methods/*.ts (业务方法)
  │
  ├─ EventBridge  ✅ 机制通用
  │   └─ events/*Bridge.ts (业务事件桥接)
  │
  └─ HTTP REST 路由  ❌ 完全是业务
      └─ http/*.ts (业务路由)
```

### 2.2 可复用的部分

**✅ 可以直接复用**：

#### A. GatewayServer（网络层）

**职责**：
- WebSocket 服务器管理
- HTTP Router 管理
- 客户端连接管理
- 心跳检测

**通用性**：⭐⭐⭐⭐⭐（完全通用）

**代码位置**：`src/main/gateway/GatewayServer.ts`

**核心 API**：
```typescript
class GatewayServer {
  // 启动服务器
  start(): void;
  
  // 向所有客户端广播
  broadcast(payload: GatewayEvent): void;
  
  // 按条件广播
  broadcastIf(payload: GatewayEvent, predicate: (meta: ClientMeta) => boolean): number;
  
  // 遍历客户端
  forEachClient(callback: (ws: WebSocket, meta: ClientMeta) => void): void;
  
  // 获取 Router（用于注册 HTTP 路由）
  getRouter(): Router;
}
```

**结论**：**可以直接复用！** 只需要：
1. 复制 `GatewayServer.ts` 到 coobee-agent
2. 修改路径前缀（如 `/gateway/ws` → `/ws/events`）
3. 去掉 RPC 消息处理（onMessage 回调留空或由业务层提供）

---

#### B. EventBridge 机制（概念通用，具体事件是业务）

**职责**：监听 EventBus 事件，转换为 WebSocket 消息

**通用性**：⭐⭐⭐⭐（机制通用，具体事件是业务）

**coobee-ai 的实现**：
```typescript
// events/StreamBridge.ts
export const initStreamBridge: EventBridgeInit = (gateway) => {
  const handleMessage = (event: StreamEvent): void => {
    gateway.broadcastEventIf('stream.message', {...}, (meta) => 
      meta.subscribedSessions.has(sessionId)
    );
  };

  eventBus.on(StreamEventType.MESSAGE, handleMessage);

  // 返回清理函数
  return () => {
    eventBus.off(StreamEventType.MESSAGE, handleMessage);
  };
};
```

**结论**：**机制可以复用，但要简化**
- coobee-ai 的 EventBridge 是独立文件 + 自动发现
- coobee-agent 可以简化为：**直接在 WebSocketEventBroadcaster 类中注册监听器**
- 类似 IpcEventBroadcaster 的 `setupEventListeners()` 方法

---

### 2.3 不需要的部分

**❌ 不复用**：

#### A. RPC 方法路由机制

**原因**：
- RPC 方法组（`methods/*.ts`）都是业务代码
- 如果需要 RPC，业务层自己实现即可

#### B. HTTP REST 路由

**原因**：
- HTTP 路由（`http/*.ts`）都是业务代码
- HttpServer 已有 Router，业务层直接注册即可

---

## 3. 最终设计方案（简化版）

### 3.1 核心组件

**只需要一个类：WebSocketEventBroadcaster**

类似 IpcEventBroadcaster，职责清晰：
1. 管理 WebSocket 服务器（复用 GatewayServer 的代码）
2. 监听 EventBus 固定事件
3. 转发到 WebSocket 客户端

### 3.2 文件结构

```
src/main/common/websocket/
├── WebSocketEventBroadcaster.ts   # 核心类（对标 IpcEventBroadcaster）
├── types.ts                        # 类型定义
└── index.ts                        # 导出
```

**就这 3 个文件！**

### 3.3 实现代码

#### A. types.ts（通用类型）

```typescript
import type { WebSocket } from 'ws';

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
export interface WebSocketEventMessage {
  type: 'event';
  event: string;
  payload: unknown;
  timestamp: number;
}
```

---

#### B. WebSocketEventBroadcaster.ts（核心类）

```typescript
/**
 * WebSocket 事件广播器
 * 负责将主进程的 EventBus 事件广播到 WebSocket 客户端
 * 
 * 设计对标 IpcEventBroadcaster，保持简洁。
 */

import type { Server as NodeHttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { eventBus } from '@main/common/eventbus';
import { log } from '@main/common/logger';
import type { HttpServer } from '@main/common/server/httpServer';
import type { ClientMeta, WebSocketEventMessage } from './types';

/**
 * WebSocket 事件通道路径
 */
export const WS_EVENT_PATH = '/ws/events' as const;

let connectionIdCounter = 0;

function generateConnectionId(): string {
  connectionIdCounter++;
  return `ws-${Date.now()}-${connectionIdCounter}`;
}

class WebSocketEventBroadcaster {
  private wss!: WebSocketServer;
  private clients = new Map<WebSocket, ClientMeta>();
  private initialized = false;
  private nodeHttpServer!: NodeHttpServer;
  private heartbeatInterval = 30000; // 30秒
  
  /** 保存所有 EventBus handler 引用，用于清理 */
  private readonly handlers = new Map<string, (data: unknown) => void>();

  /**
   * 初始化事件广播器
   * 
   * @param httpServer HttpServer 实例
   */
  init(httpServer: HttpServer): void {
    if (this.initialized) {
      log.warn('[WebSocketEventBroadcaster] Already initialized');
      return;
    }

    this.nodeHttpServer = httpServer.getHttpServer();

    // 1. 启动 WebSocket 服务器
    this.startWebSocketServer();

    // 2. 注册事件监听器（监听 EventBus）
    this.setupEventListeners();

    this.initialized = true;
    log.info('[WebSocketEventBroadcaster] Initialized');
  }

  /**
   * 启动 WebSocket 服务器
   */
  private startWebSocketServer(): void {
    this.wss = new WebSocketServer({
      server: this.nodeHttpServer,
      path: WS_EVENT_PATH
    });

    this.wss.on('connection', (ws) => {
      const meta: ClientMeta = {
        connectionId: generateConnectionId(),
        connectedAt: Date.now(),
        isAlive: true,
        heartbeatTimer: null
      };
      this.clients.set(ws, meta);
      this.startHeartbeat(ws, meta);

      log.info(`[WebSocketEventBroadcaster] Client connected: ${meta.connectionId} (total: ${this.clients.size})`);

      ws.on('pong', () => {
        meta.isAlive = true;
      });

      ws.on('close', () => {
        this.cleanupClient(ws);
        log.info(`[WebSocketEventBroadcaster] Client disconnected: ${meta.connectionId} (total: ${this.clients.size})`);
      });

      ws.on('error', (error) => {
        log.error(`[WebSocketEventBroadcaster] Client error (${meta.connectionId}):`, error);
        this.cleanupClient(ws);
      });
    });

    log.info(`[WebSocketEventBroadcaster] WebSocket server started at ${WS_EVENT_PATH}`);
  }

  /**
   * 设置事件监听器
   * 监听主进程 EventBus 的事件，转发到 WebSocket 客户端
   * 
   * ⚠️ 这里注册所有需要通过 WebSocket 推送的业务事件
   */
  private setupEventListeners(): void {
    // ==================== Stream 事件 ====================
    this.registerListener('stream:message');
    this.registerListener('stream:start');
    this.registerListener('stream:end');
    this.registerListener('stream:error');

    // ==================== Worker 事件 ====================
    this.registerListener('worker:status');
    this.registerListener('worker:progress');
    this.registerListener('worker:error');

    // ==================== Agent 事件 ====================
    this.registerListener('agent:message');
    this.registerListener('agent:started');
    this.registerListener('agent:stopped');

    // ==================== Task 事件 ====================
    this.registerListener('task:created');
    this.registerListener('task:updated');
    this.registerListener('task:completed');

    // 未来添加新的业务事件，在这里继续注册即可

    log.info('[WebSocketEventBroadcaster] Event listeners setup completed');
  }

  /**
   * 注册事件监听器并保存引用（用于后续清理）
   */
  private registerListener(eventType: string): void {
    const handler = (data: unknown): void => {
      this.broadcast(eventType, data);
    };
    this.handlers.set(eventType, handler);
    eventBus.on(eventType, handler);
  }

  /**
   * 广播事件到所有 WebSocket 客户端
   * 
   * @param event 事件类型
   * @param payload 事件负载
   */
  broadcast(event: string, payload: unknown): void {
    const message: WebSocketEventMessage = {
      type: 'event',
      event,
      payload,
      timestamp: Date.now()
    };

    const msg = JSON.stringify(message);
    let sentCount = 0;

    for (const [ws] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(msg);
          sentCount++;
        } catch (error) {
          log.warn('[WebSocketEventBroadcaster] Send failed:', error);
        }
      }
    }

    log.debug(`[WebSocketEventBroadcaster] Broadcast: ${event} -> ${sentCount} clients`);
  }

  /**
   * 按条件广播事件（可选，用于过滤客户端）
   * 
   * @param event 事件类型
   * @param payload 事件负载
   * @param predicate 过滤函数
   * @returns 发送成功的客户端数量
   */
  broadcastIf(event: string, payload: unknown, predicate: (meta: ClientMeta) => boolean): number {
    const message: WebSocketEventMessage = {
      type: 'event',
      event,
      payload,
      timestamp: Date.now()
    };

    const msg = JSON.stringify(message);
    let sentCount = 0;

    for (const [ws, meta] of this.clients) {
      if (ws.readyState === WebSocket.OPEN && predicate(meta)) {
        try {
          ws.send(msg);
          sentCount++;
        } catch (error) {
          log.warn('[WebSocketEventBroadcaster] Send failed:', error);
        }
      }
    }

    log.debug(`[WebSocketEventBroadcaster] Broadcast (filtered): ${event} -> ${sentCount} clients`);
    return sentCount;
  }

  /**
   * 启动心跳检测
   */
  private startHeartbeat(ws: WebSocket, meta: ClientMeta): void {
    meta.heartbeatTimer = setInterval(() => {
      if (!meta.isAlive) {
        log.info(`[WebSocketEventBroadcaster] Heartbeat timeout: ${meta.connectionId}`);
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

  /**
   * 清理所有 EventBus 监听器
   */
  destroy(): void {
    if (!this.initialized) {
      return;
    }

    // 移除所有 EventBus 监听器
    for (const [eventType, handler] of this.handlers) {
      eventBus.off(eventType, handler);
    }
    this.handlers.clear();

    // 关闭所有客户端连接
    for (const [ws, meta] of this.clients) {
      if (meta.heartbeatTimer) clearInterval(meta.heartbeatTimer);
      ws.terminate();
    }
    this.clients.clear();

    // 关闭 WebSocketServer
    if (this.wss) {
      this.wss.close();
    }

    this.initialized = false;
    log.info('[WebSocketEventBroadcaster] Destroyed, all listeners removed');
  }

  /**
   * 获取客户端数量
   */
  get clientCount(): number {
    return this.clients.size;
  }
}

// 导出单例
export const webSocketEventBroadcaster = new WebSocketEventBroadcaster();
```

---

#### C. index.ts（导出）

```typescript
export { webSocketEventBroadcaster } from './WebSocketEventBroadcaster';
export * from './types';
```

---

### 3.4 生命周期集成

#### A. ReadyWebSocketHook.ts

```typescript
import { LifecyclePhase, LifecycleContext, LifecycleHook } from '@main/common/types';
import { log } from '@main/common/logger';

export const ReadyWebSocketHook: LifecycleHook = {
  name: 'ready-websocket',
  phase: LifecyclePhase.READY,
  priority: 100,  // 在 HttpServer 初始化后（优先级 50）
  critical: false,

  async execute(_context: LifecycleContext): Promise<void> {
    log.info('[ReadyWebSocketHook] 启动 WebSocket 事件推送系统...');

    try {
      const { HttpServer } = await import('@main/common/server/httpServer');
      const { webSocketEventBroadcaster } = await import('@main/common/websocket');
      
      const httpServer = HttpServer.getInstance();
      if (!httpServer) {
        throw new Error('HttpServer not initialized');
      }

      // 初始化 WebSocket 事件广播器
      webSocketEventBroadcaster.init(httpServer);

      log.info('[ReadyWebSocketHook] WebSocket 事件推送系统启动完成');
    } catch (error) {
      log.error('[ReadyWebSocketHook] WebSocket 事件推送系统启动失败:', error);
      // 不抛出错误，允许应用继续运行（WebSocket 推送不是关键功能）
    }
  }
};
```

---

## 4. 使用示例

### 4.1 业务代码触发事件

**场景 1：Stream 流式输出**

```typescript
// src/main/ai/streaming/StreamManager.ts
import { eventBus } from '@main/common/eventbus';

export class StreamManager {
  emitMessage(sessionId: string, message: string): void {
    // 触发事件
    eventBus.emit('stream:message', { sessionId, message });
    
    // WebSocketEventBroadcaster 会自动监听并推送到前端
  }
}
```

**场景 2：Worker 状态变化**

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

### 4.2 前端监听事件

```typescript
// src/renderer/src/utils/websocket.ts

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private eventHandlers = new Map<string, Set<(payload: unknown) => void>>();

  connect(url = 'ws://localhost:8765/ws/events'): void {
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('[WebSocket] Connected');
    };

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      
      if (msg.type === 'event') {
        this.emit(msg.event, msg.payload);
      }
    };

    this.ws.onclose = () => {
      console.log('[WebSocket] Disconnected');
    };
  }

  on(event: string, handler: (payload: unknown) => void): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);

    return () => {
      this.eventHandlers.get(event)?.delete(handler);
    };
  }

  private emit(event: string, payload: unknown): void {
    this.eventHandlers.get(event)?.forEach((handler) => handler(payload));
  }
}

// 导出单例
export const wsClient = new WebSocketClient();
```

**使用**：
```typescript
// src/renderer/src/stores/chat.ts
import { wsClient } from '@/utils/websocket';

// 连接
wsClient.connect();

// 监听流式输出
wsClient.on('stream:message', (payload) => {
  console.log('Received stream message:', payload);
  // 更新 Pinia store
});

// 监听 Worker 状态
wsClient.on('worker:status', (payload) => {
  console.log('Worker status changed:', payload);
});
```

---

## 5. 对比总结

### 5.1 架构对比

| 特性 | v1.0（复杂版） | v2.0（简化版） |
|-----|---------------|---------------|
| **文件数量** | 10+ 文件 | 3 个文件 |
| **核心类** | WebSocketBroadcaster + EventBridge + SubscriptionManager | WebSocketEventBroadcaster（单一类） |
| **事件注册** | 自动扫描 `bridges/` 目录 | 手动在 `setupEventListeners()` 注册 |
| **代码复用** | 自己实现 WebSocket 管理 | 复用 GatewayServer 的代码 |
| **复杂度** | ⭐⭐⭐⭐ | ⭐⭐ |
| **对标组件** | - | IpcEventBroadcaster |

### 5.2 与 IpcEventBroadcaster 的对比

| 特性 | IpcEventBroadcaster | WebSocketEventBroadcaster |
|-----|---------------------|---------------------------|
| **通道** | Electron IPC | WebSocket |
| **目标** | 渲染进程 | 任意 WebSocket 客户端 |
| **事件注册** | `setupEventListeners()` | `setupEventListeners()` |
| **推送方法** | `webContents.send()` | `ws.send()` |
| **清理机制** | `destroy()` 移除监听器 | `destroy()` 移除监听器 |
| **代码结构** | 单一类 | 单一类 |

**结论**：**完全对标！** 只是推送通道不同。

---

## 6. Gateway 通用化结论

### 6.1 可以复用的部分

**✅ GatewayServer（网络层）**
- 代码位置：`coobee-ai/src/main/gateway/GatewayServer.ts`
- 通用性：⭐⭐⭐⭐⭐
- 复用方式：复制代码，修改路径前缀
- **已在 WebSocketEventBroadcaster 中复用了其核心逻辑**

**✅ EventBridge 机制（概念）**
- 概念通用：监听 EventBus → 转发到 WebSocket
- 实现简化：不需要独立文件，直接在 `setupEventListeners()` 中注册

### 6.2 不需要的部分

**❌ RPC 方法路由**
- 业务相关，不复用
- 如需要，业务层自己实现

**❌ HTTP REST 路由**
- 业务相关，不复用
- HttpServer 已有 Router，业务层直接注册

### 6.3 通用化方案

**方案 1：直接复用 GatewayServer 代码**（推荐）
- 复制 `GatewayServer.ts` 的核心代码到 `WebSocketEventBroadcaster.ts`
- 去掉 RPC 消息处理逻辑
- 去掉 HTTP Router（或保留为可选）

**方案 2：封装通用 WebSocket 基础类**
- 提取 `GatewayServer` 的 WebSocket 管理逻辑
- 封装为独立的 `WebSocketManager` 类
- `WebSocketEventBroadcaster` 和业务 RPC Handler 都可以基于它构建

**本方案采用方案 1**，因为更简单直接。

---

## 7. 最终架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        主进程架构                                │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                     EventBus                             │  │
│  │              (主进程事件总线 - 中心枢纽)                    │  │
│  └───────┬────────────────────────┬────────────────────┬─────┘  │
│          ↓                        ↓                    ↓        │
│  ┌───────────────┐    ┌──────────────────┐   ┌──────────────┐  │
│  │  事件处理器     │    │ IpcBroadcaster   │   │ WebSocketEvent│ │
│  │  (events/*.ts)│    │ (IPC 推送)       │   │ Broadcaster   │ │
│  │               │    │                  │   │ (WS 推送)     │ │
│  │ • themeChanged│    │ setupEventListen │   │ setupEventLis │ │
│  │ • trayChanged │    │ webContents.send │   │ ws.send()     │ │
│  └───────────────┘    └────────┬─────────┘   └────────┬──────┘  │
│                                ↓                      ↓         │
│                       ┌─────────────────┐   ┌──────────────┐   │
│                       │  Electron IPC   │   │  WebSocket   │   │
│                       │  (窗口/UI事件)   │   │  (业务事件)   │   │
│                       └─────────────────┘   └──────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                ↓                      ↓
                       ┌─────────────────┐   ┌──────────────┐
                       │   渲染进程 (Vue) │   │  Web 客户端   │
                       │                 │   │              │
                       │  window.api.on  │   │  WS Client   │
                       └─────────────────┘   └──────────────┘
```

---

## 8. 实施清单

**Phase 1：复制 GatewayServer 核心代码**
- [ ] 创建 `src/main/common/websocket/` 目录
- [ ] 复制 WebSocket 管理逻辑到 `WebSocketEventBroadcaster.ts`
- [ ] 定义 `types.ts`（ClientMeta, WebSocketEventMessage）

**Phase 2：实现事件监听**
- [ ] 实现 `setupEventListeners()` 方法
- [ ] 注册业务事件监听器（stream, worker, agent, task）

**Phase 3：生命周期集成**
- [ ] 创建 `ReadyWebSocketHook.ts`
- [ ] 在 Hook 中调用 `webSocketEventBroadcaster.init()`

**Phase 4：前端集成**
- [ ] 创建 `src/renderer/src/utils/websocket.ts`（WebSocketClient）
- [ ] 在 Pinia store 中监听事件

---

## 9. 总结

### 9.1 核心优势

✅ **简单**：单一类，100 行代码搞定  
✅ **清晰**：完全对标 IpcEventBroadcaster  
✅ **通用**：WebSocket 管理逻辑通用，事件注册集中  
✅ **易扩展**：新增业务事件只需在 `setupEventListeners()` 添加一行  
✅ **可维护**：所有事件注册一目了然

### 9.2 与 v1.0 对比

| 特性 | v1.0 | v2.0 |
|-----|------|------|
| 文件数量 | 10+ | 3 个 |
| 代码量 | 500+ 行 | 200 行 |
| 复杂度 | 高 | 低 |
| 学习成本 | 需要理解多个概念 | 看懂 IpcEventBroadcaster 就懂 |

### 9.3 关键代码行数对比

```
v1.0（复杂版）：
  WebSocketBroadcaster.ts:      150 行
  EventBridge (自动扫描):        50 行
  SubscriptionManager.ts:        100 行
  多个 EventBridge 文件:         200+ 行
  总计:                         500+ 行

v2.0（简化版）：
  WebSocketEventBroadcaster.ts: 200 行（包含所有逻辑）
  types.ts:                      20 行
  index.ts:                      5 行
  总计:                         225 行
```

**简化了 50%+ 的代码！**

---

**就是这么简单！** 🎉
