# 端到端测试 (E2E Tests)

## 概述

本目录包含 Coobee Agent 的端到端测试，用于验证完整的功能流程。

## 测试列表

### 1. chat-api.e2e.test.ts

测试 Chat API 的完整流程，包括：

- **Thread Management（会话管理）**
  - 创建新会话
  - 列出所有会话
  - 获取会话详情

- **Message Streaming（消息流式传输）**
  - 发送消息并接收 SSE 流式响应
  - 验证多轮对话
  - 验证数据持久化

- **Error Handling（错误处理）**
  - 不存在的会话（404）
  - 空消息（400）
  - 发送消息到不存在的会话（404）

### 2. gateway-websocket.e2e.test.ts

测试 Gateway WebSocket 的完整通信流程，包括：

- **Connection Management（连接管理）**
  - 建立 WebSocket 连接
  - 正常关闭连接
  - 处理无效连接
  - 多客户端并发连接

- **Health Check（健康检查）**
  - 服务器健康状态
  - 运行时间查询
  - 客户端数量统计

- **Event Broadcasting（事件推送）**
  - 接收服务端广播事件
  - 多个事件监听器
  - 事件分发机制

- **Connection Stability（连接稳定性）**
  - 空闲期间保持连接（心跳）
  - 快速连接/断开循环

- **Error Handling（错误处理）**
  - 格式错误的消息
  - 连接超时

- **Performance（性能测试）**
  - 突发连接处理
  - 连接延迟测量

- **Integration（集成测试）**
  - 与 Chat API 协作
  - 接收流式消息事件

详细文档: [WEBSOCKET-TEST.md](./WEBSOCKET-TEST.md)

## 前置条件

在运行端到端测试之前，请确保：

### 1. 启动应用

```bash
pnpm dev
```

应用会在 `http://127.0.0.1:8765` 启动。

### 2. 配置本地 LLM

测试使用本地 Ollama，请确保：

- Ollama 已安装并运行（默认地址：`http://127.0.0.1:11434`）
- `qwen3.5:9b` 模型已安装

```bash
# 检查 Ollama 是否运行
curl http://127.0.0.1:11434/api/tags

# 安装模型（如果未安装）
ollama pull qwen3.5:9b
```

### 3. Provider 配置

确保 `.home/providers.json5` 文件中已启用 Ollama：

```json5
{
  ollama: {
    id: 'ollama',
    name: 'Ollama',
    api: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKey: 'ollama',
    requiresApiKey: false,
    enabled: true,  // ✅ 必须设置为 true
    models: [
      {
        id: 'qwen3.5:9b',
        name: 'Qwen3.5 9B',
        contextWindow: 32768,
      }
    ]
  }
}
```

**注意**：
- 不要使用 `.env` 文件配置 Provider（`VITE_LLM_*` 变量无效）
- 应用从 `.home/providers.json5` 加载 Provider 配置
- 如果文件不存在，应用会报错"API Key 未配置"

## 运行测试

### 运行所有端到端测试

```bash
pnpm test:e2e
```

### 以监视模式运行

```bash
pnpm test:e2e --watch
```

### 运行特定测试文件

```bash
# Chat API 测试
pnpm test:e2e tests/chat-api.e2e.test.ts

# WebSocket 测试
pnpm test:e2e tests/gateway-websocket.e2e.test.ts
```

### 运行特定测试用例

```bash
# Chat API 测试用例
pnpm test:e2e -t "should create a new thread"

# WebSocket 测试用例
pnpm test:e2e -t "should establish WebSocket connection"
```

### 详细输出模式

```bash
pnpm test:e2e --reporter=verbose
```

## 测试输出示例

### Chat API 测试输出

```
🚀 开始 Chat API 端到端测试
📍 目标地址: http://127.0.0.1:8765
🤖 测试模型: qwen3.5:9b

 ✓ Thread Management (3)
   ✓ should create a new thread
   ✓ should list all threads
   ✓ should get thread by id

 ✓ Message Streaming (SSE) (2)
   ✓ should send message and receive SSE stream
   ✓ should handle multiple messages in the same thread

 ✓ Error Handling (3)
   ✓ should return 404 for non-existent thread
   ✓ should return 400 for empty message
   ✓ should return 404 for message to non-existent thread

Test Files  1 passed (1)
     Tests  8 passed (8)
  Duration  24.58s
```

### WebSocket 测试输出

```
🚀 开始 Gateway WebSocket 端到端测试
📍 WebSocket 地址: ws://127.0.0.1:8765/gateway/ws
📍 HTTP 地址: http://127.0.0.1:8765

 ✓ Connection Management (4)
   ✓ should establish WebSocket connection
   ✓ should handle connection close
   ✓ should reject connection to invalid URL
   ✓ should handle multiple concurrent connections

 ✓ Health Check (1)
   ✓ should return server health status

 ✓ Event Broadcasting (2)
   ✓ should receive broadcasted events
   ✓ should handle multiple event listeners

 ✓ Connection Stability (2)
   ✓ should maintain connection during idle period
   ✓ should handle rapid connect/disconnect cycles

 ✓ Error Handling (2)
   ✓ should handle malformed WebSocket messages gracefully
   ✓ should handle connection timeout

 ✓ Performance (2)
   ✓ should handle burst connections
   ✓ should measure connection latency

 ✓ Integration with Chat API (1)
   ✓ should receive stream events when sending chat message

Test Files  1 passed (1)
     Tests  14 passed (14)
  Duration  9.54s

性能指标:
  - 连接延迟: 平均 1.60ms, 最小 1ms, 最大 3ms
  - 并发连接: 10 个连接耗时 4ms (平均 0.40ms/连接)
```

## 故障排查

### 1. 连接错误

**错误**：`ECONNREFUSED 127.0.0.1:8765`

**解决**：确保应用已启动
```bash
pnpm dev
```

### 2. Ollama 连接失败

**错误**：`fetch failed` 或 `ECONNREFUSED 127.0.0.1:11434`

**解决**：
1. 启动 Ollama：`ollama serve`
2. 检查 Ollama 状态：`curl http://127.0.0.1:11434/api/tags`

### 3. 模型不存在

**错误**：`404 model 'qwen3.5:9b' not found`

**解决**：安装模型
```bash
ollama pull qwen3.5:9b
```

### 4. 测试超时

**错误**：`Test timed out in 60000ms`

**解决**：
- 检查网络连接
- 增加 `testTimeout`（在 `vitest.e2e.config.ts` 中）
- 使用更小的模型（如 `qwen2.5:0.5b`）

## 数据持久化验证

测试完成后，可以在以下位置找到持久化的数据：

```
.home/workspaces/{threadId}/
├── sessions/           # 会话消息历史
│   └── *.jsonl
├── contexts/          # 上下文文件
└── .runtime/
    └── events/        # 事件日志
        └── events.jsonl
```

## 清理测试数据

测试会创建会话和持久化数据，如需清理：

```bash
# 清理所有测试数据
rm -rf .home/workspaces/*
rm -rf .home/threads/*
```

## 编写新测试

在 `tests/` 目录下创建新的 `*.e2e.test.ts` 文件：

```typescript
import { describe, it, expect } from 'vitest';

describe('My E2E Test', () => {
  it('should do something', async () => {
    // 测试代码
  });
});
```

## CI/CD 集成

端到端测试可以集成到 CI/CD 流程中：

```yaml
# .github/workflows/e2e.yml
name: E2E Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v3
      
      # 安装依赖
      - run: pnpm install
      
      # 启动 Ollama（如果使用 Docker）
      - run: docker run -d -p 11434:11434 ollama/ollama
      - run: docker exec ollama ollama pull qwen3.5:9b
      
      # 启动应用（后台）
      - run: pnpm dev &
      - run: sleep 10  # 等待应用启动
      
      # 运行测试
      - run: pnpm test:e2e
```

## 相关文档

### Chat API
- [Chat API 数据流设计](../docs/01-designs/05-chat-api-data-flow.md)
- [Chat API 路由实现](../src/main/routes/ChatRoutes.ts)
- [AgentExecutor 集成测试](../src/main/agent/__tests__/AgentExecutor.integration.test.ts)

### Gateway WebSocket
- [WebSocket 测试详细文档](./WEBSOCKET-TEST.md)
- [Gateway Server 实现](../src/main/common/gateway/GatewayServer.ts)
- [Gateway 协议定义](../src/shared/gateway-protocol.ts)
- [前端客户端实现](../src/renderer/src/services/GatewayClient.ts)
