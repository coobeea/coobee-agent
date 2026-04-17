# 聊天系统前后端对接文档

> 日期：2026-04-17  
> 版本：v1.0  
> 状态：✅ 已实施

## 概述

完成聊天消息展示系统的前后端对接，实现：
1. ✅ 实时流式消息推送（WebSocket）
2. ✅ 历史消息加载（HTTP API）
3. ✅ 用户消息发送（Gateway RPC）
4. ✅ 完整的消息渲染（Vue 组件）

## 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                         后端                                 │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  AgentExecutor.stream()                                      │
│       ↓                                                      │
│  StreamEmitter.forward(chunk)                               │
│       ↓                                                      │
│  EventBus.emit('stream:message', StreamEvent)               │
│       ↓                                                      │
│  StreamPublisher（监听 EventBus）                            │
│       ↓                                                      │
│  Gateway.broadcastEvent('stream:message', StreamEvent)      │
│       ↓                                                      │
│  GatewayServer.broadcast({                                  │
│    type: 'event',                                           │
│    event: 'stream:message',                                 │
│    payload: StreamEvent,                                    │
│    timestamp: ...                                           │
│  })                                                          │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                             ↓ WebSocket
┌─────────────────────────────────────────────────────────────┐
│                        前端                                  │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  GatewayClient.on('stream:message', handler)                │
│       ↓                                                      │
│  useStreamWs (提取 payload.message)                         │
│       ↓                                                      │
│  AgentChatPanel (handleStreamMessage)                       │
│       ↓                                                      │
│  useStreamHandler (转换为 ContentBlock[])                   │
│       ↓                                                      │
│  ChatMessages / MessageItem* / Block*                       │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## 核心实现

### 1. 后端流式推送

#### StreamPublisher.ts
```typescript
// 声明需要推送的事件
export default ['stream:message', 'stream:start', 'stream:end', 'stream:error'];
```

#### StreamEmitter.ts
```typescript
forward(chunk: StreamChunk): void {
  const message = this.buildMessage(chunk.type, chunk.content, chunk.data);
  
  const event: StreamEvent = {
    type: StreamEventType.MESSAGE, // 'stream:message'
    sessionId: this.sessionId,
    message,                        // <- StreamMessage
    timestamp: Date.now()
  };
  
  eventBus.emit(StreamEventType.MESSAGE, event);
}
```

#### Gateway.ts
```typescript
// 自动注册 StreamPublisher
broadcastEvent('stream:message', payload): void {
  const msg = {
    type: 'event',
    event: 'stream:message',
    payload,  // <- StreamEvent { message: StreamMessage }
    timestamp: Date.now()
  };
  this.server.broadcast(msg);
}
```

### 2. 前端实时订阅

#### useStreamWs.ts
```typescript
// 修复：从 payload.message 中提取 StreamMessage
gateway.on('stream:message', (payload: unknown) => {
  const event = payload as { message?: StreamMessage };
  const msg = event.message;
  
  if (!msg) return;
  
  const callbacks = this.subscriptions.get(msg.sessionId);
  if (callbacks) {
    callbacks.forEach((cb) => cb(msg));
  }
});
```

**关键修复**：
- ❌ 旧实现：`const msg = payload as StreamMessage`
- ✅ 新实现：`const msg = event.message`（从 StreamEvent 中提取）

### 3. 历史消息加载

#### ThreadRoutes.ts（后端 HTTP API）
```typescript
router.get('/threads/:threadId/history', async (ctx) => {
  // 1. 读取 events.jsonl
  const eventsFile = path.join(workspacePath, '.runtime', 'events', 'events.jsonl');
  const events = parseJsonl(eventsFile);
  
  // 2. 提取用户消息（从 session 文件）
  const userMessages = await extractUserMessages(workspacePath, sessionId);
  
  // 3. 返回
  ctx.body = { events, userMessages };
});
```

#### AgentChatPanel.vue（前端加载逻辑）
```typescript
async function loadHistory(): Promise<void> {
  const res = await fetch(`${baseUrl}/threads/${threadId.value}/history`);
  const data = await res.json();
  
  let userIdx = 0;
  for (const evt of data.events) {
    // 在 run:start 前插入用户消息
    if (evt.type === 'run:start' && userIdx < data.userMessages.length) {
      addUserMessage(data.userMessages[userIdx].content);
      userIdx++;
    }
    
    // 处理历史事件
    const streamMsg: StreamMessage = {
      id: `hist-${evt.seq}`,
      sessionId: threadId.value,
      sequence: evt.seq,
      timestamp: new Date(evt.ts).getTime(),
      type: evt.type,
      content: evt.content,
      data: evt.data,
      source: { type: 'agent', id: agentId, name: '' }
    };
    
    handleStreamMessage(streamMsg);
  }
}
```

### 4. 用户消息发送

#### ChatMethods.ts（后端 RPC）
```typescript
sendMessage: async (params) => {
  const { threadId, message } = params;
  
  // 1. 加载 Thread 和 Agent 配置
  const thread = await store.get(threadId);
  const agent = await agentStore.get(thread.agentId);
  
  // 2. 创建 Builder
  const builder = agentExecutor.piMono()
    .sessionMode('file')
    .name(agent.id)
    .model(thread.overrideModel || agent.model)
    .instructions(agent.instructions);
  
  // 3. 启动流式执行
  const gen = agentExecutor.stream({
    sessionId: thread.id,
    message,
    builder
  });
  
  // 4. 异步消费（触发 WebSocket 推送）
  (async () => {
    for await (const _chunk of gen) {
      // WebSocket 事件已由 EventBridge 自动推送
    }
  })();
  
  return { success: true };
}
```

#### AgentChatPanel.vue（前端发送）
```typescript
async function sendMessage(): Promise<void> {
  // 1. 添加用户消息到 UI
  addUserMessage(userMessage);
  
  // 2. 调用 Gateway RPC
  await request('chat.sendMessage', {
    threadId: threadId.value,
    message: userMessage
  });
}
```

## 消息流转时序

### 1. 用户发送消息

```
用户输入 "Hello"
    ↓
AgentChatPanel.sendMessage()
    ↓
addUserMessage("Hello")  // 立即显示用户消息
    ↓
gateway.request('chat.sendMessage', { threadId, message: "Hello" })
    ↓
后端 ChatMethods.sendMessage()
    ↓
AgentExecutor.stream()  // 启动异步执行
    ↓
返回 { success: true }  // RPC 立即返回
```

### 2. AI 流式响应

```
AgentExecutor 内部循环：
    ↓
for await (const chunk of runtime.generate()) {
  StreamEmitter.forward(chunk)
      ↓
  EventBus.emit('stream:message', StreamEvent)
      ↓
  StreamPublisher 监听 → Gateway.broadcastEvent()
      ↓
  GatewayServer.broadcast({ type: 'event', event: 'stream:message', ... })
      ↓
  WebSocket 推送给所有客户端
}
```

### 3. 前端接收并渲染

```
GatewayClient 接收 WebSocket 消息
    ↓
gateway.on('stream:message') 触发
    ↓
useStreamWs 路由到对应 sessionId 的回调
    ↓
AgentChatPanel.handleStreamMessage()
    ↓
useStreamHandler.handleStreamMessage()
    ↓
根据 msg.type 处理：
  - run:start       → 创建新 assistant 消息
  - reasoning:delta → 累积思考内容
  - tool:start      → 添加工具调用块
  - text:delta      → 累积文本内容
  - run:done        → 标记完成
    ↓
Vue 响应式更新 → ChatMessages 重新渲染
```

## 关键数据结构

### StreamChunk（后端 Runtime 输出）
```typescript
interface StreamChunk {
  type: StreamChunkType;  // 'run:start', 'text:delta', 'tool:start', ...
  content: string;
  data?: Record<string, unknown>;
}
```

### StreamMessage（前后端共享）
```typescript
interface StreamMessage {
  id: string;
  sessionId: string;
  sequence: number;
  type: string;           // 直接透传 StreamChunk.type
  content: string;
  data?: Record<string, unknown>;
  timestamp: number;
  source: StreamSource;
}
```

### StreamEvent（后端 EventBus）
```typescript
interface StreamEvent {
  type: 'stream:message';
  sessionId: string;
  message: StreamMessage;  // <- 嵌套在这里
  timestamp: number;
}
```

### GatewayEvent（WebSocket 推送）
```typescript
interface GatewayEvent {
  type: 'event';
  event: 'stream:message';
  payload: StreamEvent;   // <- 嵌套在这里
  timestamp: number;
}
```

### ContentBlock（前端 UI）
```typescript
interface ContentBlock {
  type: 'text' | 'thinking' | 'tool';
  text?: string;
  tool?: ToolCall;
}
```

## 测试验证

### 1. 启动应用
```bash
pnpm dev
```

### 2. 打开浏览器控制台

### 3. 检查 WebSocket 连接
```javascript
// 应该看到：
[GatewayClient] Connected to ws://127.0.0.1:8765/gateway/ws
[gatewaySetup] Backend ready, connecting to Gateway WebSocket...
```

### 4. 打开 Agent 工作区
- 导航到 Agent 工作区视图
- 右侧面板应显示对话区域

### 5. 发送测试消息
- 输入：`你好`
- 按回车发送

### 6. 验证前端日志
```javascript
// 应该看到：
[useStreamWs] 收到消息: { type: 'run:start', sessionId: 'xxx', ... }
[useStreamWs] 收到消息: { type: 'text:delta', content: '你', ... }
[useStreamWs] 收到消息: { type: 'text:delta', content: '好', ... }
[useStreamWs] 收到消息: { type: 'run:done', ... }
```

### 7. 验证 UI 渲染
- ✅ 用户消息立即显示
- ✅ AI 消息逐字显示
- ✅ 工具调用显示状态图标
- ✅ 思考过程可折叠

### 8. 刷新页面
- ✅ 历史消息自动加载
- ✅ 消息顺序正确
- ✅ 用户消息和 AI 消息对应

## 常见问题

### 1. WebSocket 连接失败
**症状**：控制台显示 `Connection error`

**排查**：
```bash
# 检查后端是否启动
curl http://127.0.0.1:8765/gateway/health

# 检查 WebSocket 是否可连接
websocat ws://127.0.0.1:8765/gateway/ws
```

### 2. 消息不显示
**症状**：发送消息后没有 AI 响应

**排查**：
1. 打开浏览器控制台，查看是否有 JavaScript 错误
2. 检查 `useStreamWs` 是否正确提取 `payload.message`
3. 检查后端日志：`tail -f logs/app.log`

### 3. 历史消息加载失败
**症状**：刷新页面后历史消息不显示

**排查**：
```bash
# 检查 events.jsonl 是否存在
ls -la .home/workspaces/{threadId}/.runtime/events/events.jsonl

# 手动测试 API
curl http://127.0.0.1:8765/gateway/threads/{threadId}/history
```

### 4. 消息顺序错乱
**症状**：用户消息和 AI 消息顺序不对

**原因**：历史消息加载逻辑中，用户消息的插入时机不正确

**修复**：确保在 `run:start` 事件之前插入用户消息

## 性能优化

### 1. 限制历史消息数量
```typescript
// 在 ThreadRoutes.ts 中添加分页
router.get('/threads/:threadId/history', async (ctx) => {
  const { limit = 100, offset = 0 } = ctx.query;
  const events = allEvents.slice(offset, offset + limit);
  // ...
});
```

### 2. 虚拟滚动
```bash
pnpm add vue-virtual-scroller
```

```vue
<RecycleScroller :items="messages" :item-size="80" />
```

### 3. 防抖滚动
```typescript
import { useDebounceFn } from '@vueuse/core';

const scrollToBottom = useDebounceFn((container: HTMLElement) => {
  container.scrollTop = container.scrollHeight;
}, 100);
```

## 未来扩展

### 1. 消息搜索
- 全文搜索
- 按时间/类型筛选

### 2. 消息导出
- 导出为 Markdown
- 导出为 PDF

### 3. 离线缓存
- 使用 IndexedDB 本地缓存
- 离线查看历史消息

### 4. HITL 审批 UI
- 添加审批按钮
- 调用 Gateway RPC 提交决策

## 参考资料

- [聊天消息展示系统架构设计](./08-chat-message-system-architecture.md)
- [Gateway RPC 协议](../common/gateway/README.md)
- [Stream 事件推送配置](../../src/main/publishers/StreamPublisher.ts)
