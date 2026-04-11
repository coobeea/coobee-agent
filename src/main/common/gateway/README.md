# Gateway 模块

Gateway 是 coobee-agent 的**统一网络层**，提供极简的一站式网络服务。

## 📁 目录结构

```
src/main/common/gateway/      # 【统一网络层】
├── Gateway.ts                # 统一入口（自动扫描 + 编排）
├── GatewayServer.ts          # HTTP + WebSocket 一体化管理
├── types.ts                  # 类型定义
├── index.ts                  # 统一导出
└── README.md                 # 本文档

src/main/                     # 【业务层】
├── publishers/               # WebSocket 事件推送配置（自动扫描）
│   ├── StreamPublisher.ts
│   └── WorkerPublisher.ts
│
└── routes/                   # HTTP REST 路由（自动扫描）
    └── HealthRoutes.ts
```

## 🏗️ 架构设计

### 极简两层架构

```
业务层 (src/main/publishers/ + routes/)
  ├─ StreamPublisher.ts  # 推送配置（声明式）
  ├─ WorkerPublisher.ts  # 推送配置（声明式）
  └─ HealthRoutes.ts     # HTTP 路由
         ↓
Gateway 统一层 (Gateway + GatewayServer 一体化)
  ├─ Gateway.ts          # 自动扫描 + 注册
  └─ GatewayServer.ts    # HTTP + WebSocket 一体化
     ├─ Koa App + http.Server（统一端口）
     ├─ WebSocketServer（挂载到 http.Server）
     └─ Gateway Router（挂载到 Koa）
```

### 核心特性

✅ **极简对外接口**：只需 `gateway.start()` 一行代码
✅ **一体化管理**：HTTP + WebSocket + 业务路由统一管理
✅ **自动扫描**：业务文件通过命名约定自动注册
✅ **单例模式**：全局唯一实例，防止重复初始化

│ ├── types.ts # 类型定义
│ ├── index.ts # 导出
│ └── README.md # 本文档
│
├── publishers/ # 业务层：WebSocket 事件推送配置（自动扫描）
│ ├── StreamPublisher.ts # Stream 事件推送
│ ├── WorkerPublisher.ts # Worker 事件推送
│ └── ... # 新增推送配置在这里添加文件
│
└── routes/ # 业务层：HTTP REST 路由（自动扫描）
├── HealthRoutes.ts # 健康检查路由
└── ... # 新增 HTTP 接口在这里添加文件

```

## 🏗️ 架构设计

### 分层原则

```

业务层 (src/main/publishers/ + routes/)
├─ StreamPublisher.ts # 推送配置（声明式）
├─ WorkerPublisher.ts # 推送配置（声明式）
└─ HealthRoutes.ts # HTTP 路由
↓
Gateway 统一层 (Gateway + GatewayServer 一体化)
├─ Gateway.ts # 自动扫描 + 注册
└─ GatewayServer.ts # HTTP + WebSocket 一体化
├─ Koa App + http.Server（统一端口）
├─ WebSocketServer（挂载到 http.Server）
└─ Gateway Router（挂载到 Koa）

````

## 🚀 快速开始

### 启动 Gateway

```typescript
// src/main/lifecycle/ReadyGatewayHook.ts
import { gateway } from '@main/common/gateway';

// 一行代码启动整个网络层
gateway.start();

// 自动完成：
// 1. 创建 Koa App + http.Server（监听端口 8765）
// 2. 创建 WebSocketServer（挂载到 http.Server）
// 3. 自动扫描 publishers/ → 注册事件推送配置
// 4. 自动扫描 routes/ → 注册 HTTP 路由
````

### 关闭 Gateway

```typescript
await gateway.close();
```

就是这么简单！

---

## 📝 使用指南

### A. 新增 WebSocket 事件推送（极简！）

**场景**：添加 Agent 事件推送

**步骤 1：创建推送配置文件（只需 5 行！）**

```typescript
// src/main/publishers/AgentPublisher.ts
export default ['agent:created', 'agent:deleted', 'agent:message', 'agent:status'];
```

**步骤 2：业务代码触发事件**

```typescript
// src/main/ai/AgentManager.ts
import { eventBus } from '@main/common/eventbus';

export class AgentManager {
  sendMessage(agentId: string, message: string): void {
    // 触发事件，Gateway 自动推送到 WebSocket 客户端
    eventBus.emit('agent:message', { agentId, message });
  }
}
```

**完成！** Gateway 会自动扫描并注册，就像 `events/` 一样简单！

---

### 进阶：支持数据转换（对象形式）

如果需要转换数据或改名：

```typescript
// src/main/publishers/ThreadPublisher.ts
export default {
  'thread:message': (data) => ({ ...data, timestamp: Date.now() }), // 转换
  'thread:created': 'thread:created', // 改名（可选）
  'thread:deleted': true // 直接转发
};
```

**完成！** Gateway 会自动扫描并注册 `AgentBridge.ts`。

---

### B. 新增 HTTP REST 路由

**场景**：添加 Thread 管理接口

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

  log.info('[ThreadRoutes] HTTP 路由注册完成');
}
```

**完成！** Gateway 会自动扫描并注册这些路由。

---

## 🔄 工作流程

### 统一启动流程

```
ReadyGatewayHook (优先级 50)
   └─→ gateway.start()
       ├─ 1. new GatewayServer()
       │   ├─ 创建 Koa App
       │   ├─ 配置中间件（cors, bodyParser, static）
       │   └─ 创建 Gateway Router
       │
       ├─ 2. scanGatewayPublishers()
       │   └─ 自动注册 publishers/*Publisher.ts
       │       • 数组形式 → registerArrayPublisher()
       │       • 对象形式 → registerObjectPublisher()
       │
       ├─ 3. scanGatewayRoutes()
       │   └─ 自动注册 routes/*Routes.ts
       │
       └─ 4. server.start()
           ├─ 创建 http.Server
           ├─ 监听端口 8765
           ├─ 挂载 WebSocketServer (/gateway/ws)
           └─ 挂载 Router 到 Koa
```

### 事件流转

```
业务代码
  ↓ eventBus.emit('worker:status')
EventBus
  ↓ 触发监听器
EventPublisher (publishers/WorkerPublisher.ts)
  ↓ gateway.broadcastEvent()
GatewayServer
  ↓ ws.send()
WebSocket 客户端
```

## 📡 网络端点

### WebSocket

- **路径**：`ws://localhost:8765/gateway/ws`
- **协议**：JSON 消息
- **用途**：业务事件推送

### HTTP

- **前缀**：`http://localhost:8765/gateway/`
- **示例**：
  - `GET /gateway/health` - 健康检查
  - `GET /gateway/system/health` - 系统健康检查
  - `GET /gateway/system/info` - 系统信息

## 🧪 测试

### 手动测试 WebSocket

```bash
# 使用 websocat 连接
websocat ws://localhost:8765/gateway/ws

# 等待事件推送
# 会收到 JSON 消息：{"type":"event","event":"stream:message","payload":{...},"timestamp":...}
```

### 手动测试 HTTP

```bash
# 健康检查
curl http://localhost:8765/gateway/health

# 系统信息
curl http://localhost:8765/gateway/system/info
```

## 🔍 调试

查看 Gateway 日志：

```
[Gateway] Started
[Gateway] 事件桥接发现完成: 共 2 个
[Gateway] HTTP 路由发现完成: 共 1 个
[GatewayServer] Started (WS: /gateway/ws, HTTP: /gateway/*)
[Gateway] 注册推送配置（数组）: StreamPublisher.ts (4 个事件)
[Gateway] 注册推送配置（数组）: WorkerPublisher.ts (3 个事件)
[HealthRoutes] HTTP 路由注册完成
```

## 📋 文件约定

### 事件推送配置约定

**文件命名**：`*Publisher.ts`（如 `StreamPublisher.ts`）
**文件位置**：`src/main/publishers/`

**导出格式**（三选一）：

**1. 数组形式（最简，推荐）**

```typescript
export default ['event1', 'event2', 'event3'];
```

**2. 对象形式（支持改名/转换）**

```typescript
export default {
  event1: 'targetEvent1', // 改名
  event2: true, // 直接转发
  event3: (data) => ({ ...data, extra: 'field' }) // 转换
};
```

**3. 函数形式（复杂场景）**

```typescript
export const initCustomPublisher: EventBridgeInit = (gateway) => {
  // 自定义逻辑
  return () => {
    /* cleanup */
  };
};
```

---

### HTTP Routes 约定

- **文件名**：`*Routes.ts`（如 `ThreadRoutes.ts`）
- **位置**：`src/main/routes/`
- **导出**：`export function register{Name}Routes(router: Router): void`

## ⚠️ 注意事项

1. **不要在通用层添加业务逻辑**
   - Gateway.ts 和 GatewayServer.ts 是通用层
   - 业务逻辑只能在 publishers/ 和 routes/ 中

2. **推送配置使用 export default**
   - 数组形式：`export default ['event1', 'event2']`
   - 对象形式：`export default { 'event1': true }`
   - 函数形式：`export const init*: EventBridgeInit = ...`（兼容复杂场景）

3. **文件命名必须遵循约定**
   - 否则不会被自动扫描
   - Publisher 文件必须以 `Publisher.ts` 结尾
   - Routes 文件必须以 `Routes.ts` 结尾

4. **自动清理**
   - 框架自动管理 EventBus 监听器的生命周期
   - 无需手动编写清理代码

---

更多设计细节请参考：[docs/01-designs/03-gateway-auto-scan-design.md](../../docs/01-designs/03-gateway-auto-scan-design.md)
