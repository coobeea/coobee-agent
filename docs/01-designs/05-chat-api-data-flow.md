# Chat API 数据流设计

> 日期：2026-04-13
> 版本：v1.0
> 状态：✅ 已实施

## 概述

Chat API 提供基于 HTTP SSE 的对话接口，同时保持与 Electron 前端的 WebSocket 实时同步。所有会话都走**统一完整流程**，确保数据持久化、实时广播和 API 返回三者并行。

## 架构设计

### 数据流图

```
用户请求 (POST /gateway/chat/threads/:id/messages)
    ↓
ChatRoutes.ts
    ↓
AgentExecutor.stream({ sessionId, message, builder })
    ↓
    ├─→ [路径 1: 持久化] 写入文件系统
    │       workspaces/{threadId}/
    │       ├── sessions/*.jsonl        (消息历史)
    │       ├── contexts/               (上下文管理)
    │       └── .runtime/events/        (事件日志)
    │
    ├─→ [路径 2: WebSocket] EventBus 广播
    │       eventWriter.dispatch(chunk)
    │           ↓
    │       StreamEmitter.forward(chunk)
    │           ↓
    │       EventBus.emit('stream:message', event)
    │           ↓
    │       WebSocket 推送到 Electron 前端
    │
    └─→ [路径 3: SSE] HTTP 流式返回
            yield chunk
                ↓
            PassThrough stream
                ↓
            SSE Response (text/event-stream)
                ↓
            HTTP 客户端接收
```

## 核心组件

### 1. ChatRoutes.ts

**职责**：提供 REST API 端点，管理会话（Thread）生命周期

**端点**：
- `POST /gateway/chat/threads` - 创建新会话
- `GET /gateway/chat/threads` - 列出所有会话
- `GET /gateway/chat/threads/:id` - 获取会话详情
- `POST /gateway/chat/threads/:id/messages` - 发送消息（SSE 流式返回）

**关键配置**：
```typescript
const builder = agentExecutor
  .piMono()
  .sessionMode('file')  // ← 启用完整流程
  .name(agent.id)
  .model(thread.overrideModel || agent.model);
```

**注意**：
- ❌ 不使用 `lightweight(true)`
- ✅ 所有会话都走完整流程

### 2. AgentExecutor.stream()

**职责**：执行 Agent 推理，管理数据流分发

**核心逻辑**：
```typescript
async *stream(request) {
  const isLightweight = builder.getLightweight?.() ?? false;  // 默认 false
  
  if (!isLightweight) {
    // 完整流程初始化
    const workspace = await injectEnv(sessionId, builder);
    eventWriter = new AgentEventWriter(workspace);
    eventWriter.register(sessionId);
  }
  
  for await (const chunk of runtime.stream(message)) {
    // [路径 1 & 2] 持久化 + WebSocket 广播
    if (eventWriter && !isLightweight) {
      eventWriter.dispatch(chunk);  // ← 写文件 + EventBus
    }
    
    // [路径 3] SSE 返回
    yield chunk;  // ← 返回给 HTTP 客户端
  }
}
```

### 3. AgentEventWriter

**职责**：统一分发 StreamChunk 到文件和 EventBus

**核心方法**：
```typescript
dispatch(chunk: StreamChunk): number {
  const seq = ++this.seq;
  
  // 1. 持久化到文件
  this.writeEvent(chunk, seq);
  
  // 2. 推送到前端（通过 EventBus → WebSocket）
  if (this.emitter) {
    this.emitter.forward(chunk);
  }
  
  return seq;
}
```

### 4. StreamEmitter

**职责**：将 StreamChunk 转换为 StreamEvent 并广播到 EventBus

**数据转换**：
```typescript
forward(chunk: StreamChunk): void {
  // 直接透传 chunk.type，不做映射
  const message = this.buildMessage(chunk.type, chunk.content, chunk.data);
  
  const event: StreamEvent = {
    type: StreamEventType.MESSAGE,
    sessionId: this.sessionId,
    message,
    timestamp: Date.now()
  };
  
  eventBus.emit(StreamEventType.MESSAGE, event);
}
```

## 数据结构

### StreamChunk

所有流式事件的统一载体：

```typescript
interface StreamChunk {
  /** 事件类型（如 'text:delta', 'tool:start', 'run:done'） */
  type: StreamChunkType;
  /** 主要内容（文本增量、工具名、错误信息等） */
  content: string;
  /** 额外数据（token 用量、工具参数等） */
  data?: StreamChunkData;
  /** Agent 名称（多 Agent 场景） */
  agentName?: string;
}
```

### 事件类型示例

```typescript
// 运行状态
{ type: 'run:start', content: '', data: {} }
{ type: 'run:done', content: '', data: { usage: { inputTokens, outputTokens } } }

// 文本生成
{ type: 'text:delta', content: '你好', data: {} }
{ type: 'text:done', content: '', data: { totalLength: 1234 } }

// 工具调用
{ type: 'tool:start', content: 'read_file', data: { args: { path: '...' } } }
{ type: 'tool:done', content: '成功', data: { result: {...} } }

// 推理链
{ type: 'reasoning:delta', content: '让我思考一下...', data: {} }
```

## SSE 响应格式

### 数据块

```
data: {"type":"text:delta","content":"你好","data":{}}

data: {"type":"text:delta","content":"世界","data":{}}

```

### 结束标记

```
event: done
data: [DONE]

```

### 错误事件

```
event: error
data: {"message":"执行失败"}

```

## 持久化机制

### 目录结构

```
.home/workspaces/{threadId}/
├── sessions/
│   ├── 20260413_001.jsonl      # 会话消息
│   └── 20260413_002.jsonl
├── contexts/
│   ├── system.txt              # 系统提示词
│   └── user_context.txt        # 用户上下文
└── .runtime/
    └── events/
        └── events.jsonl        # 所有 StreamChunk 事件日志
```

### 文件格式

**sessions/*.jsonl** - 消息历史：
```jsonl
{"role":"user","content":"你好","timestamp":1713024000000}
{"role":"assistant","content":"你好！有什么我可以帮助你的吗？","timestamp":1713024001234}
```

**events.jsonl** - 事件日志：
```jsonl
{"seq":1,"type":"run:start","content":"","timestamp":1713024000000}
{"seq":2,"type":"text:delta","content":"你好","timestamp":1713024001000}
{"seq":3,"type":"text:done","content":"","timestamp":1713024001500}
```

## 设计原则

### 1. 统一流程

- ✅ 所有会话都走完整流程（持久化 + WebSocket + SSE）
- ❌ 不使用 `lightweight` 模式
- ✅ 确保数据一致性和可追溯性

### 2. 双路并行

- **WebSocket 路径**：Electron 前端实时监听（原有架构）
- **SSE 路径**：HTTP API 客户端流式接收（新增功能）
- 两者互不干扰，并行推送

### 3. 完整持久化

- 支持规划（Planning）机制
- 支持任务（Task）管理
- 支持上下文压缩
- 支持会话恢复

### 4. 可扩展性

- Extension 可以注入自定义事件
- 支持多 Agent 场景（agentName 字段）
- 支持事件过滤和订阅

## 使用示例

### 创建会话并发送消息

```bash
# 1. 创建新会话
curl -X POST http://localhost:8765/gateway/chat/threads \
  -H "Content-Type: application/json" \
  -d '{
    "title": "我的对话",
    "agentId": "app-copilot",
    "overrideModel": "qwen3.5:9b"
  }'

# 响应
{
  "success": true,
  "data": {
    "id": "1234567890",
    "title": "我的对话",
    "agentId": "app-copilot",
    ...
  }
}

# 2. 发送消息（SSE）
curl -X POST http://localhost:8765/gateway/chat/threads/1234567890/messages \
  -H "Content-Type: application/json" \
  -d '{"message": "你好"}' \
  --no-buffer

# SSE 响应流
data: {"type":"run:start","content":"","data":{}}

data: {"type":"text:delta","content":"你好","data":{}}

data: {"type":"text:delta","content":"！","data":{}}

data: {"type":"text:done","content":"","data":{"totalLength":3}}

data: {"type":"run:done","content":"","data":{"usage":{"inputTokens":10,"outputTokens":5}}}

event: done
data: [DONE]
```

## 性能考量

### 1. 文件 I/O

- 使用追加写入（append），避免全量读写
- 事件日志按天轮转，防止单文件过大
- 异步写入，不阻塞主流程

### 2. 内存管理

- 使用 Node.js Stream（PassThrough）管理 SSE 响应
- 避免缓存完整响应，实时推送
- 及时清理已完成的会话上下文

### 3. 并发控制

- `SessionStatus` 防止同一会话并发执行
- Extension 加载/卸载使用异步队列
- WebSocket 广播使用 EventBus 解耦

## 未来扩展

### 1. 多客户端同步

- 支持多个 HTTP 客户端同时订阅同一会话
- 通过 `threadId` + `connectionId` 管理订阅

### 2. 断点续传

- 支持从指定 `seq` 恢复事件流
- 利用 `events.jsonl` 重放历史事件

### 3. 事件过滤

- 客户端可指定感兴趣的事件类型
- 例如：只订阅 `text:*` 事件，忽略工具调用

### 4. 速率限制

- 基于 IP/Token 的请求速率限制
- 防止恶意客户端占用资源

## 相关文件

- `src/main/routes/ChatRoutes.ts` - HTTP 路由
- `src/main/agent/AgentExecutor.ts` - 执行器
- `src/main/agent/AgentEventWriter.ts` - 事件分发器
- `src/main/agent/streaming/StreamEmitter.ts` - EventBus 适配器
- `src/main/agent/threads/ThreadStore.ts` - 会话存储
- `src/main/routes/__tests__/ChatRoutes.integration.test.ts` - 集成测试
