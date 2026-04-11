# WebSocket 业务事件推送架构设计方案

> ⚠️ **注意**：本方案已被 [03-gateway-auto-scan-design.md](03-gateway-auto-scan-design.md) 替代，保留作为历史参考。

> 日期：2026-04-11  
> 版本：v1.0  
> 状态：⚠️ 已废弃

## 📋 目录

- [1. 背景与目标](#1-背景与目标)
- [2. coobee-ai Gateway 架构分析](#2-coobee-ai-gateway-架构分析)
- [3. 当前 coobee-agent 架构分析](#3-当前-coobee-agent-架构分析)
- [4. 核心问题与挑战](#4-核心问题与挑战)
- [5. 设计方案](#5-设计方案)
- [6. 实现路径](#6-实现路径)
- [7. 使用示例](#7-使用示例)
- [8. 与现有架构的关系](#8-与现有架构的关系)

---

## 1. 背景与目标

### 1.1 需求背景

在 Electron 应用中，存在两种不同的通信需求：

**A. 原生窗口/UI 事件** → 使用 **Electron IPC**
- Window 生命周期（创建、关闭、焦点等）
- Tab 管理（创建、激活、移动等）
- App 级事件（激活、退出等）
- **特点**：与 Electron 架构紧密绑定，需要实时性

**B. 业务逻辑事件** → 使用 **WebSocket 推送**
- AI 对话流式输出（stream events）
- Worker 状态变化（训练进度、模型加载等）
- Agent 生命周期事件
- 文件处理进度、任务状态变化
- **特点**：业务驱动，需要持久连接，可能有复杂过滤逻辑

### 1.2 设计目标

1. **分层清晰**：WebSocket 推送层是通用的，不包含业务逻辑
2. **职责单一**：推送机制和业务逻辑解耦
3. **可复用**：所有业务事件都通过统一的 EventBus + WebSocket 通道推送
4. **不影响现有架构**：IPC 推送机制保持独立，互不干扰
5. **易扩展**：新增业务事件只需添加 EventBridge，不修改推送层

---

## 2. coobee-ai Gateway 架构分析

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         Gateway.ts                              │
│                      (核心编排器)                                │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │  自动扫描并注册    │  │  自动扫描并初始化  │  │  注册 REST   │ │
│  │  methods/*.ts    │  │  events/*Bridge  │  │  http/*.ts   │ │
│  │  (RPC 方法组)     │  │  (事件桥接)       │  │  (HTTP 路由) │ │
│  └──────────────────┘  └──────────────────┘  └──────────────┘ │
│           ↓                     ↓                     ↓         │
└───────────┼─────────────────────┼─────────────────────┼─────────┘
            │                     │                     │
            └─────────────────────┴─────────────────────┘
                                  ↓
                    ┌─────────────────────────────┐
                    │      GatewayServer.ts       │
                    │       (网络层)               │
                    │                             │
                    │  WebSocket (/gateway/ws)    │
                    │  HTTP REST (/gateway/*)     │
                    └─────────────────────────────┘
```

### 2.2 核心组件

#### A. Gateway.ts（核心编排器）

**职责**：
- 管理 GatewayServer 生命周期
- 自动发现并注册方法组（`methods/*.ts`）
- 自动发现并初始化事件桥接（`events/*Bridge.ts`）
- 路由客户端 RPC 请求到对应方法
- 提供事件广播 API

**关键代码**：
```typescript
export class Gateway implements GatewayApi {
  private server: GatewayServer | null = null;
  private methods = new Map<string, MethodHandler>();
  private eventBridgeCleanups: Array<() => void> = [];

  start(): void {
    // 1. 创建 GatewayServer（WebSocket + HTTP）
    this.server = new GatewayServer({ ... });
    
    // 2. 自动发现方法组和事件桥接
    this.discoverMethods();
    this.discoverEventBridges();
    
    // 3. 启动网络层
    this.server.start();
  }

  // 供业务代码调用的广播 API
  broadcastEvent(event: string, payload: unknown): void {
    const msg: GatewayEvent = { type: 'event', event, payload };
    this.server.broadcast(msg);
  }
}
```

#### B. GatewayServer.ts（网络层）

**职责**：
- 创建 WebSocketServer，挂载到 HttpServer
- 管理 WebSocket 客户端连接
- 提供消息发送、广播、心跳检测
- 创建 Koa Router，注册 HTTP 路由

**关键代码**：
```typescript
export class GatewayServer {
  private wss!: WebSocketServer;
  private router: Router;
  private clients = new Map<WebSocket, ClientMeta>();

  start(): void {
    // 1. WebSocket 层：挂载到 http.Server
    this.wss = new WebSocketServer({
      server: this.nodeHttpServer,
      path: '/gateway/ws'
    });

    // 2. HTTP 层：挂载 Router 到 Koa app
    const app = this.options.httpServer.getApp();
    app.use(this.router.routes());
  }

  // 向所有客户端广播事件
  broadcast(payload: GatewayEvent): void {
    const msg = JSON.stringify(payload);
    for (const [ws] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  }

  // 按条件广播（支持过滤）
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
}
```

#### C. EventBridge（事件桥接）

**职责**：监听主进程 EventBus 事件，转换为 WebSocket 事件推送

**示例：StreamBridge.ts**
```typescript
export const initStreamBridge: EventBridgeInit = (gateway) => {
  const handleMessage = (event: StreamEvent): void => {
    // 只推送给订阅了该 sessionId 的客户端
    gateway.broadcastEventIf('stream.message', 
      { sessionId, message: event.message }, 
      (meta) => meta.subscribedSessions.has(sessionId)
    );
  };

  eventBus.on(StreamEventType.MESSAGE, handleMessage);

  // 返回清理函数（取消订阅）
  return () => {
    eventBus.off(StreamEventType.MESSAGE, handleMessage);
  };
};
```

#### D. MethodGroup（RPC 方法组）

**职责**：处理客户端 RPC 请求（业务逻辑）

**示例：chat.ts**
```typescript
export const chatMethods: MethodGroup = {
  namespace: 'chat',
  methods: {
    send: async (params, ctx) => {
      // 业务逻辑：发送消息
      const { message, sessionId } = params;
      
      // 通过 AgentExecutor 执行
      await agentExecutor.execute({ ... });
      
      return { success: true };
    },
    
    abort: async (params) => {
      // 业务逻辑：中止会话
      // ...
    }
  }
};
```

### 2.3 消息协议

#### 客户端 → Gateway（RPC 请求）
```json
{
  "type": "req",
  "id": "req-123",
  "method": "chat.send",
  "params": { "message": "你好", "sessionId": "abc" }
}
```

#### Gateway → 客户端（RPC 响应）
```json
{
  "type": "res",
  "id": "req-123",
  "ok": true,
  "payload": { "success": true }
}
```

#### Gateway → 客户端（事件推送）
```json
{
  "type": "event",
  "event": "stream.message",
  "payload": { "sessionId": "abc", "message": "你好" }
}
```

### 2.4 优点

✅ **自动发现机制**：方法组和事件桥接自动扫描注册  
✅ **协议统一**：RPC + Event 共用一个 WebSocket 连接  
✅ **条件广播**：支持按 sessionId 等条件过滤推送目标  
✅ **清理机制**：EventBridge 返回清理函数，防止内存泄漏

### 2.5 问题

❌ **业务逻辑混杂**：
- `methods/*.ts` 文件包含大量 AI、Worker、Thread 等业务代码
- `events/*Bridge.ts` 文件也需要理解业务 Event 结构
- Gateway 启动时还要初始化 CronSystem、TaskScheduler 等业务模块

❌ **推送层不够通用**：
- Gateway 和业务逻辑耦合度高
- 难以区分"通用推送能力"和"业务事件处理"

---

## 3. 当前 coobee-agent 架构分析

### 3.1 IPC 事件推送架构（已有）

```
┌─────────────────────────────────────────────────────────────────┐
│                      主进程业务逻辑                              │
│                                                                 │
│  Config.setTheme()  →  eventBus.emit('config:theme:changed')   │
│  WindowManager      →  eventBus.emit('window:created')         │
│  TabManager         →  eventBus.emit('tab:activated')          │
└───────────────────────────────┬─────────────────────────────────┘
                                ↓
                    ┌───────────────────────────┐
                    │       EventBus.ts         │
                    │   (主进程事件总线)         │
                    └───────────┬───────────────┘
                                ↓
              ┌─────────────────┴──────────────────┐
              ↓                                    ↓
    ┌──────────────────────┐          ┌──────────────────────┐
    │  主进程内部监听器      │          │  IpcEventBroadcaster │
    │  (events/*.ts)       │          │  (转发到渲染进程)     │
    │                      │          │                      │
    │  - themeChanged.ts   │          │  监听 EventBus 事件  │
    │  - trayChanged.ts    │          │  ↓                   │
    │  ...                 │          │  webContents.send()  │
    └──────────────────────┘          └──────────┬───────────┘
                                                  ↓
                                      ┌───────────────────────┐
                                      │    渲染进程 (Vue)      │
                                      │                       │
                                      │  window.api.on(...)   │
                                      │  更新 UI              │
                                      └───────────────────────┘
```

**特点**：
- ✅ **分层清晰**：EventBus（通用）+ EventBroadcaster（IPC 专用）+ EventHandlers（业务）
- ✅ **职责单一**：IpcEventBroadcaster 只负责"转发"，不包含业务逻辑
- ✅ **自动发现**：events/*.ts 自动扫描注册

### 3.2 HTTP 服务架构（已有）

```
┌─────────────────────────────────────────────────────────────────┐
│                      HttpServer.ts                              │
│                   (Koa.js + http.Server)                        │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  const app = new Koa()                                   │  │
│  │  const server = http.createServer(app.callback())        │  │
│  │                                                           │  │
│  │  app.use(koaBody())                                      │  │
│  │  app.use(koaCors())                                      │  │
│  │  app.use(router.routes())                                │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**特点**：
- ✅ **基础设施完善**：Koa app + http.Server 已初始化
- ✅ **可复用**：WebSocket 可以挂载到这个 http.Server
- ✅ **端口统一**：HTTP 和 WebSocket 共用一个端口

---

## 4. 核心问题与挑战

### 4.1 问题陈述

**用户的核心诉求**：
> "我想要一套 WebSocket 推送系统，用于业务事件推送。WebSocket 这一层应该是通用的，但业务逻辑要和推送机制分离。不要像 coobee-ai 的 Gateway 那样，业务和推送混在一起。"

**核心矛盾**：
- **完全通用**：推送层只负责"发送消息"，完全不知道业务事件结构 → 过于简化，缺少实用功能（如条件过滤）
- **包含业务**：推送层理解业务事件（如 sessionId 过滤）→ 失去通用性，每个业务都要修改推送层

### 4.2 coobee-ai Gateway 的教训

**问题 1：业务逻辑侵入推送层**
```typescript
// GatewayServer.ts 中的 ClientMeta
export interface ClientMeta {
  connectionId: string;
  connectedAt: number;
  isAlive: boolean;
  heartbeatTimer: NodeJS.Timeout | null;
  subscribedSessions: Set<string>;  // ❌ 业务相关：订阅的 sessionId
}

// StreamBridge.ts 中使用业务字段进行过滤
gateway.broadcastEventIf('stream.message', payload, (meta) =>
  meta.subscribedSessions.has(sessionId)  // ❌ 业务逻辑
);
```

**问题 2：Gateway 启动时初始化业务模块**
```typescript
// Gateway.ts start() 方法
start(): void {
  // ...
  void this.startCronSystem().catch(...);      // ❌ 业务模块
  void this.startTaskScheduler().catch(...);   // ❌ 业务模块
}
```

**问题 3：方法组包含大量业务代码**
- `methods/chat.ts`：500+ 行，包含 AI、Skill、Tool 逻辑
- `methods/worker.ts`：管理 Python Worker 进程
- 每个方法文件都是一个小型"业务模块"

### 4.3 设计挑战

**挑战 1：如何定义"通用层"的边界？**
- WebSocket 连接管理？ ✅ 通用
- 消息序列化/反序列化？ ✅ 通用
- 心跳检测？ ✅ 通用
- 按条件过滤客户端？ ⚠️ 灰色地带（可能需要业务字段）
- 订阅/取消订阅某个频道？ ⚠️ 灰色地带（频道定义是业务概念）

**挑战 2：如何实现过滤而不侵入业务？**
- 业务需求：只向订阅了 `sessionId=abc` 的客户端推送 `stream.message`
- 方案 A：ClientMeta 包含 `subscribedSessions: Set<string>` → ❌ 业务侵入
- 方案 B：推送层不管过滤，业务层自己维护订阅关系 → ⚠️ 复杂度转移

**挑战 3：EventBridge 是通用还是业务？**
- EventBridge 监听 EventBus 事件，转换为 WebSocket 推送
- 它需要理解业务 Event 的数据结构（如 `StreamEvent`）
- **结论**：EventBridge 属于**业务层**，不是通用层

---

## 5. 设计方案

### 5.1 核心理念

**分层原则**：

```
┌─────────────────────────────────────────────────────────────────┐
│                     业务逻辑层                                   │
│  - EventBridge (业务事件 → WebSocket 事件)                      │
│  - RPC Methods (处理业务 RPC 请求)                              │
│  - HTTP REST Routes (处理业务 HTTP 请求)                        │
└────────────────────────────┬────────────────────────────────────┘
                             ↓ 调用
┌─────────────────────────────────────────────────────────────────┐
│                   通用 WebSocket 推送层                          │
│  - WebSocketBroadcaster (通用广播器)                            │
│    • 连接管理、心跳检测                                          │
│    • 发送消息、广播消息                                          │
│    • 客户端过滤（基于谓词函数，不关心具体业务字段）              │
│  - ClientMeta (通用客户端元数据)                                │
│    • connectionId, connectedAt, isAlive, heartbeatTimer         │
│    • extraData: Map<string, unknown> (扩展字段，业务自定义)      │
└────────────────────────────┬────────────────────────────────────┘
                             ↓ 基于
┌─────────────────────────────────────────────────────────────────┐
│                       HttpServer                                │
│  (Koa.js + http.Server，已有基础设施)                            │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 架构设计

#### 层次 1：通用 WebSocket 推送层

##### A. WebSocketBroadcaster（通用广播器）

**职责**：
- 管理 WebSocket 客户端连接
- 提供消息发送、广播、条件广播 API
- 心跳检测、连接清理
- **不包含任何业务逻辑**

**核心 API**：
```typescript
export class WebSocketBroadcaster {
  private wss!: WebSocketServer;
  private clients = new Map<WebSocket, ClientMeta>();

  /**
   * 启动 WebSocket 服务器
   * @param httpServer HttpServer 实例
   * @param path WebSocket 路径（如 '/ws/events'）
   */
  start(httpServer: HttpServer, path: string): void;

  /**
   * 向单个客户端发送消息
   */
  send(ws: WebSocket, message: unknown): void;

  /**
   * 向所有客户端广播消息
   */
  broadcast(message: unknown): void;

  /**
   * 按条件广播消息
   * @param predicate 过滤函数，返回 true 则发送
   */
  broadcastIf(message: unknown, predicate: (meta: ClientMeta) => boolean): number;

  /**
   * 遍历所有客户端
   */
  forEachClient(callback: (ws: WebSocket, meta: ClientMeta) => void): void;

  /**
   * 设置客户端扩展数据（业务层使用）
   */
  setClientData(ws: WebSocket, key: string, value: unknown): void;

  /**
   * 获取客户端扩展数据
   */
  getClientData(ws: WebSocket, key: string): unknown | undefined;

  /**
   * 关闭服务器
   */
  close(): Promise<void>;
}
```

**ClientMeta 定义**（通用，无业务字段）：
```typescript
export interface ClientMeta {
  connectionId: string;
  connectedAt: number;
  isAlive: boolean;
  heartbeatTimer: NodeJS.Timeout | null;
  
  /**
   * 扩展数据（业务层可以存储自定义字段）
   * 例如：extraData.set('subscribedSessions', new Set(['abc', 'def']))
   */
  extraData: Map<string, unknown>;
}
```

**实现文件**：`src/main/common/websocket/WebSocketBroadcaster.ts`

---

#### 层次 2：业务逻辑层

##### A. EventBridge（业务事件桥接）

**职责**：
- 监听主进程 EventBus 事件
- 将业务事件转换为 WebSocket 消息
- 调用 WebSocketBroadcaster 的 API 进行推送
- **包含业务逻辑**（理解业务事件结构）

**示例：StreamEventBridge.ts**
```typescript
import { eventBus } from '@main/common/eventbus';
import { webSocketBroadcaster } from '@main/common/websocket';
import { StreamEventType, type StreamEvent } from '@main/ai/streaming/types';

export function initStreamEventBridge(): () => void {
  const handleStreamMessage = (event: StreamEvent): void => {
    // 业务逻辑：只推送给订阅了该 sessionId 的客户端
    webSocketBroadcaster.broadcastIf(
      {
        type: 'event',
        event: 'stream.message',
        payload: { sessionId: event.sessionId, message: event.message }
      },
      (meta) => {
        // 读取业务扩展数据
        const subscribedSessions = meta.extraData.get('subscribedSessions') as Set<string> | undefined;
        return subscribedSessions?.has(event.sessionId) ?? false;
      }
    );
  };

  const handleStreamStart = (event: StreamEvent): void => {
    webSocketBroadcaster.broadcastIf(
      {
        type: 'event',
        event: 'stream.start',
        payload: { sessionId: event.sessionId }
      },
      (meta) => {
        const subscribedSessions = meta.extraData.get('subscribedSessions') as Set<string> | undefined;
        return subscribedSessions?.has(event.sessionId) ?? false;
      }
    );
  };

  // 注册监听器
  eventBus.on(StreamEventType.MESSAGE, handleStreamMessage);
  eventBus.on(StreamEventType.START, handleStreamStart);

  // 返回清理函数
  return () => {
    eventBus.off(StreamEventType.MESSAGE, handleStreamMessage);
    eventBus.off(StreamEventType.START, handleStreamStart);
  };
}
```

**实现目录**：`src/main/websocket/bridges/`

##### B. RPC Handler（可选，如果需要 RPC 功能）

**职责**：
- 监听 WebSocket 客户端发来的 RPC 请求
- 路由到对应的业务方法
- 返回响应

**示例：ChatRpcHandler.ts**
```typescript
import { webSocketBroadcaster } from '@main/common/websocket';
import { agentExecutor } from '@main/ai/AgentExecutor';

export function initChatRpcHandler(): () => void {
  // 监听 WebSocket 客户端消息
  const handleMessage = (ws: WebSocket, data: unknown): void => {
    const msg = data as { type: string; id: string; method: string; params: unknown };
    
    if (msg.type === 'req' && msg.method === 'chat.send') {
      handleChatSend(ws, msg.id, msg.params as { message: string; sessionId: string });
    }
  };

  const handleChatSend = async (ws: WebSocket, requestId: string, params: { message: string; sessionId: string }): Promise<void> => {
    try {
      // 业务逻辑：发送消息到 AI
      await agentExecutor.execute({ ... });

      // 返回响应
      webSocketBroadcaster.send(ws, {
        type: 'res',
        id: requestId,
        ok: true,
        payload: { success: true }
      });
    } catch (error) {
      webSocketBroadcaster.send(ws, {
        type: 'res',
        id: requestId,
        ok: false,
        error: { code: 500, message: String(error) }
      });
    }
  };

  // 注册到 WebSocketBroadcaster 的消息回调
  // （需要在 WebSocketBroadcaster 中添加 onMessage 回调支持）
  
  // 返回清理函数
  return () => {
    // 清理逻辑
  };
}
```

**实现目录**：`src/main/websocket/handlers/`（可选）

##### C. 订阅管理（业务层）

**职责**：
- 处理客户端的订阅/取消订阅请求
- 维护客户端的订阅状态（存储在 ClientMeta.extraData）

**示例：SubscriptionManager.ts**
```typescript
import { webSocketBroadcaster } from '@main/common/websocket';

export class SubscriptionManager {
  /**
   * 订阅 session
   */
  subscribe(ws: WebSocket, sessionId: string): void {
    const meta = webSocketBroadcaster.getClientMeta(ws);
    if (!meta) return;

    let subscribedSessions = meta.extraData.get('subscribedSessions') as Set<string> | undefined;
    if (!subscribedSessions) {
      subscribedSessions = new Set();
      meta.extraData.set('subscribedSessions', subscribedSessions);
    }

    subscribedSessions.add(sessionId);
    log.info(`[SubscriptionManager] Client ${meta.connectionId} subscribed to session ${sessionId}`);
  }

  /**
   * 取消订阅 session
   */
  unsubscribe(ws: WebSocket, sessionId: string): void {
    const meta = webSocketBroadcaster.getClientMeta(ws);
    if (!meta) return;

    const subscribedSessions = meta.extraData.get('subscribedSessions') as Set<string> | undefined;
    if (subscribedSessions) {
      subscribedSessions.delete(sessionId);
      log.info(`[SubscriptionManager] Client ${meta.connectionId} unsubscribed from session ${sessionId}`);
    }
  }
}

export const subscriptionManager = new SubscriptionManager();
```

**实现文件**：`src/main/websocket/SubscriptionManager.ts`

---

#### 层次 3：初始化与生命周期管理

##### A. WebSocket 模块初始化 Hook

**职责**：
- 启动 WebSocketBroadcaster
- 初始化所有 EventBridge
- 初始化 SubscriptionManager（可选）

**实现：ReadyWebSocketHook.ts**
```typescript
import { LifecyclePhase, LifecycleContext, LifecycleHook } from '@main/common/types';
import { log } from '@main/common/logger';

export const ReadyWebSocketHook: LifecycleHook = {
  name: 'ready-websocket',
  phase: LifecyclePhase.READY,
  priority: 100,
  critical: false,

  async execute(_context: LifecycleContext): Promise<void> {
    log.info('[ReadyWebSocketHook] 启动 WebSocket 推送系统...');

    try {
      // 1. 启动 WebSocketBroadcaster
      const { HttpServer } = await import('@main/common/server/httpServer');
      const { webSocketBroadcaster } = await import('@main/common/websocket');
      
      const httpServer = HttpServer.getInstance();
      if (!httpServer) {
        throw new Error('HttpServer not initialized');
      }

      webSocketBroadcaster.start(httpServer, '/ws/events');

      // 2. 自动发现并初始化所有 EventBridge
      const { scanWebSocketBridges } = await import('@main/common/scan');
      const modules = scanWebSocketBridges();
      
      const cleanups: Array<() => void> = [];
      for (const { path: filePath, module } of modules) {
        for (const [exportName, exportValue] of Object.entries(module)) {
          if (typeof exportValue === 'function' && exportName.startsWith('init')) {
            try {
              const cleanup = exportValue();
              if (cleanup) {
                cleanups.push(cleanup);
              }
              log.debug(`[ReadyWebSocketHook] 初始化 EventBridge: ${exportName} (来自 ${filePath})`);
            } catch (error) {
              log.error(`[ReadyWebSocketHook] EventBridge 初始化失败: ${exportName}`, error);
            }
          }
        }
      }

      log.info(`[ReadyWebSocketHook] WebSocket 推送系统启动完成，已初始化 ${cleanups.length} 个 EventBridge`);
    } catch (error) {
      log.error('[ReadyWebSocketHook] WebSocket 推送系统启动失败:', error);
      throw error;
    }
  }
};
```

**实现文件**：`src/main/lifecycle/ReadyWebSocketHook.ts`

---

### 5.3 目录结构

```
src/main/
├── common/
│   └── websocket/
│       ├── WebSocketBroadcaster.ts    # 通用 WebSocket 推送层（核心）
│       ├── types.ts                   # 通用类型定义
│       └── index.ts                   # 导出
│
├── websocket/                         # 业务层（所有业务相关代码）
│   ├── bridges/                       # EventBridge（业务事件 → WebSocket）
│   │   ├── StreamEventBridge.ts      # Stream 事件桥接
│   │   ├── WorkerEventBridge.ts      # Worker 事件桥接
│   │   ├── AgentEventBridge.ts       # Agent 事件桥接
│   │   └── ...
│   │
│   ├── handlers/                      # RPC Handler（可选，如果需要 RPC）
│   │   ├── ChatRpcHandler.ts         # 处理 chat.send 等 RPC 请求
│   │   └── ...
│   │
│   ├── SubscriptionManager.ts         # 订阅管理（业务层）
│   └── index.ts                       # 业务层统一导出
│
└── lifecycle/
    └── ReadyWebSocketHook.ts          # WebSocket 模块初始化 Hook
```

---

## 6. 实现路径

### Phase 1: 通用 WebSocket 推送层（底层基础设施）

#### 1.1 实现 WebSocketBroadcaster

**文件**：`src/main/common/websocket/WebSocketBroadcaster.ts`

**关键功能**：
- [x] WebSocketServer 创建与挂载
- [x] 客户端连接管理（clients Map）
- [x] 心跳检测（ping/pong）
- [x] 消息发送 API（send, broadcast, broadcastIf）
- [x] ClientMeta 定义（包含 extraData）
- [x] 生命周期管理（start, close）

#### 1.2 定义通用类型

**文件**：`src/main/common/websocket/types.ts`

```typescript
export interface ClientMeta {
  connectionId: string;
  connectedAt: number;
  isAlive: boolean;
  heartbeatTimer: NodeJS.Timeout | null;
  extraData: Map<string, unknown>;
}

export type ClientPredicate = (meta: ClientMeta) => boolean;

export interface WebSocketMessage {
  type: string;
  [key: string]: unknown;
}
```

#### 1.3 导出模块

**文件**：`src/main/common/websocket/index.ts`

```typescript
export { WebSocketBroadcaster } from './WebSocketBroadcaster';
export * from './types';

// 单例导出
import { WebSocketBroadcaster } from './WebSocketBroadcaster';
export const webSocketBroadcaster = new WebSocketBroadcaster();
```

---

### Phase 2: 业务层（EventBridge + SubscriptionManager）

#### 2.1 实现第一个 EventBridge（以 Stream 为例）

**文件**：`src/main/websocket/bridges/StreamEventBridge.ts`

**步骤**：
1. 监听 EventBus 的 `stream:*` 事件
2. 转换为 WebSocket 消息格式
3. 调用 `webSocketBroadcaster.broadcastIf()` 推送
4. 返回清理函数

#### 2.2 实现 SubscriptionManager

**文件**：`src/main/websocket/SubscriptionManager.ts`

**步骤**：
1. 提供 `subscribe(ws, sessionId)` 和 `unsubscribe(ws, sessionId)` 方法
2. 将订阅状态存储在 `ClientMeta.extraData`
3. （可选）提供 HTTP/WebSocket 接口供前端调用

---

### Phase 3: 生命周期集成

#### 3.1 实现 ReadyWebSocketHook

**文件**：`src/main/lifecycle/ReadyWebSocketHook.ts`

**步骤**：
1. 启动 WebSocketBroadcaster
2. 自动扫描并初始化所有 EventBridge
3. 记录 cleanup 函数（用于应用退出时清理）

#### 3.2 更新扫描工具

**文件**：`src/main/common/scan.ts`

**新增函数**：
```typescript
export function scanWebSocketBridges(): Array<{ path: string; module: Record<string, unknown> }> {
  const modules = import.meta.glob('@main/websocket/bridges/*Bridge.ts', { eager: true });
  return Object.entries(modules).map(([path, module]) => ({
    path,
    module: module as Record<string, unknown>
  }));
}
```

---

### Phase 4: 前端集成（可选）

#### 4.1 WebSocket 客户端封装

**文件**：`src/renderer/src/utils/websocket.ts`

```typescript
export class WebSocketClient {
  private ws: WebSocket | null = null;
  private eventHandlers = new Map<string, Set<(payload: unknown) => void>>();

  connect(url: string): void {
    this.ws = new WebSocket(url);

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      
      if (msg.type === 'event') {
        this.emit(msg.event, msg.payload);
      } else if (msg.type === 'res') {
        // 处理 RPC 响应
      }
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

  subscribe(sessionId: string): void {
    // 发送订阅请求（需要实现对应的 RPC 或 HTTP 接口）
  }

  unsubscribe(sessionId: string): void {
    // 发送取消订阅请求
  }
}
```

---

## 7. 使用示例

### 7.1 业务代码：添加新的事件推送

**需求**：Worker 状态变化时推送到前端

**步骤 1：定义 EventBridge**

**文件**：`src/main/websocket/bridges/WorkerEventBridge.ts`

```typescript
import { eventBus } from '@main/common/eventbus';
import { webSocketBroadcaster } from '@main/common/websocket';
import { log } from '@main/common/logger';

export function initWorkerEventBridge(): () => void {
  const handleWorkerStatusChanged = (event: { workerId: string; status: string }): void => {
    // 广播给所有客户端（无过滤）
    webSocketBroadcaster.broadcast({
      type: 'event',
      event: 'worker.status',
      payload: { workerId: event.workerId, status: event.status }
    });
  };

  eventBus.on('worker:status:changed', handleWorkerStatusChanged);

  log.info('[WorkerEventBridge] Worker 事件桥接初始化完成');

  return () => {
    eventBus.off('worker:status:changed', handleWorkerStatusChanged);
  };
}
```

**步骤 2：触发事件**

在 WorkerManager 中：
```typescript
// src/main/common/worker/WorkerManager.ts
export class WorkerManager {
  async startWorker(workerId: string): Promise<void> {
    // ... 启动逻辑 ...
    
    // 触发事件
    eventBus.emit('worker:status:changed', { workerId, status: 'running' });
  }
}
```

**步骤 3：前端监听**

```typescript
// src/renderer/src/stores/worker.ts
import { wsClient } from '@/utils/websocket';

wsClient.on('worker.status', (payload) => {
  console.log('Worker status changed:', payload);
  // 更新 Pinia store
});
```

**完成！无需修改 WebSocketBroadcaster 任何代码。**

---

### 7.2 业务代码：带过滤的事件推送

**需求**：只向订阅了某个 Agent 的客户端推送 Agent 事件

**步骤 1：定义 EventBridge**

**文件**：`src/main/websocket/bridges/AgentEventBridge.ts`

```typescript
import { eventBus } from '@main/common/eventbus';
import { webSocketBroadcaster } from '@main/common/websocket';

export function initAgentEventBridge(): () => void {
  const handleAgentMessage = (event: { agentId: string; message: string }): void => {
    // 只推送给订阅了该 agentId 的客户端
    webSocketBroadcaster.broadcastIf(
      {
        type: 'event',
        event: 'agent.message',
        payload: { agentId: event.agentId, message: event.message }
      },
      (meta) => {
        const subscribedAgents = meta.extraData.get('subscribedAgents') as Set<string> | undefined;
        return subscribedAgents?.has(event.agentId) ?? false;
      }
    );
  };

  eventBus.on('agent:message', handleAgentMessage);

  return () => {
    eventBus.off('agent:message', handleAgentMessage);
  };
}
```

**步骤 2：实现订阅接口**

在 SubscriptionManager 中：
```typescript
// src/main/websocket/SubscriptionManager.ts
export class SubscriptionManager {
  subscribeAgent(ws: WebSocket, agentId: string): void {
    const meta = webSocketBroadcaster.getClientMeta(ws);
    if (!meta) return;

    let subscribedAgents = meta.extraData.get('subscribedAgents') as Set<string> | undefined;
    if (!subscribedAgents) {
      subscribedAgents = new Set();
      meta.extraData.set('subscribedAgents', subscribedAgents);
    }

    subscribedAgents.add(agentId);
  }
}
```

**步骤 3：前端调用订阅**

```typescript
// 前端代码
wsClient.subscribe('agent', 'agent-123');
wsClient.on('agent.message', (payload) => {
  console.log('Agent message:', payload);
});
```

---

## 8. 与现有架构的关系

### 8.1 与 IPC 事件推送的关系

**职责分工**：

| 特性 | IPC 推送（IpcEventBroadcaster） | WebSocket 推送（WebSocketBroadcaster） |
|-----|--------------------------------|---------------------------------------|
| **用途** | Electron 原生 UI 事件 | 业务逻辑事件 |
| **通道** | `webContents.send('ipc:event')` | `WebSocket` (`/ws/events`) |
| **目标** | Electron 渲染进程（BrowserWindow/WebContentsView） | 任意 WebSocket 客户端（包括前端、移动端、Web） |
| **事件类型** | WINDOW_*, TAB_*, APP_* | stream.*, worker.*, agent.* 等业务事件 |
| **协议** | Electron IPC | WebSocket JSON 消息 |
| **生命周期** | 与 Electron 窗口绑定 | 独立持久连接 |

**两者共存，互不干扰**：
```
主进程 EventBus
    ↓
    ├─→ IpcEventBroadcaster  →  Electron IPC  →  渲染进程（UI 更新）
    │
    └─→ WebSocketBroadcaster  →  WebSocket  →  前端/客户端（业务数据）
```

### 8.2 与 HttpServer 的关系

**复用关系**：
- WebSocketBroadcaster 挂载到 HttpServer 的 `http.Server`
- 共享同一个端口（如 8765）
- 不创建新的服务器实例

**初始化顺序**：
```
1. ReadyApiRegistrationHook (优先级 50)
   └─→ 初始化 HttpServer
   
2. ReadyWebSocketHook (优先级 100)
   └─→ 启动 WebSocketBroadcaster（依赖 HttpServer）
```

### 8.3 架构全景

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
│  │  事件处理器     │    │ IpcBroadcaster   │   │ WebSocketBroad│  │
│  │  (events/*.ts)│    │ (IPC 推送)       │   │ caster (WS推送)│  │
│  │               │    │                  │   │               │  │
│  │ • themeChanged│    │ webContents.send │   │ ws.send()     │  │
│  │ • trayChanged │    │                  │   │               │  │
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

## 9. 总结

### 9.1 核心优势

✅ **分层清晰**：
- 通用层（WebSocketBroadcaster）完全不包含业务逻辑
- 业务层（EventBridge）独立管理业务事件推送

✅ **职责单一**：
- WebSocketBroadcaster：连接管理 + 消息推送
- EventBridge：业务事件 → WebSocket 消息转换

✅ **易扩展**：
- 新增业务事件推送只需添加 EventBridge 文件
- 无需修改通用层代码

✅ **可复用**：
- 所有业务事件共用一个 WebSocket 通道
- 复用 HttpServer 基础设施

✅ **不影响现有架构**：
- IPC 推送机制保持独立
- EventBus 作为中心枢纽，支持多种推送方式

### 9.2 与 coobee-ai Gateway 的对比

| 特性 | coobee-ai Gateway | 本方案 |
|-----|-------------------|--------|
| **分层** | Gateway 包含业务逻辑 | 通用层 + 业务层分离 |
| **ClientMeta** | 包含 `subscribedSessions` 等业务字段 | 只包含通用字段，业务字段存在 `extraData` |
| **EventBridge** | 混在 Gateway 中 | 独立的 `bridges/` 目录 |
| **RPC 方法** | 包含大量业务代码 | 可选（如需要则放在 `handlers/`） |
| **扩展性** | 修改 Gateway.ts | 只添加 EventBridge 文件 |

### 9.3 开发清单

**Phase 1: 通用层**
- [ ] `src/main/common/websocket/WebSocketBroadcaster.ts`
- [ ] `src/main/common/websocket/types.ts`
- [ ] `src/main/common/websocket/index.ts`

**Phase 2: 业务层**
- [ ] `src/main/websocket/bridges/StreamEventBridge.ts`
- [ ] `src/main/websocket/SubscriptionManager.ts`

**Phase 3: 生命周期**
- [ ] `src/main/lifecycle/ReadyWebSocketHook.ts`
- [ ] 更新 `src/main/common/scan.ts`（添加 `scanWebSocketBridges()`）

**Phase 4: 前端集成（可选）**
- [ ] `src/renderer/src/utils/websocket.ts`

---

**问题或建议？**

请在实现过程中根据实际情况调整细节。本方案的核心理念是**分层清晰、职责单一**，确保通用层不包含业务逻辑。
