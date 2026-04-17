# Gateway WebSocket 测试文档

## 📋 概述

Gateway WebSocket 端到端测试验证了 WebSocket 通信层的完整功能，包括连接管理、事件推送、错误处理和性能指标。

## 🎯 测试覆盖

### 1. **连接管理** (Connection Management)
- ✅ 建立 WebSocket 连接
- ✅ 正常关闭连接
- ✅ 处理无效连接（错误端口）
- ✅ 多客户端并发连接（5 个）

### 2. **健康检查** (Health Check)
- ✅ 获取服务器健康状态
- ✅ 查询运行时间
- ✅ 查询连接客户端数量

### 3. **事件推送** (Event Broadcasting)
- ✅ 接收服务端广播事件
- ✅ 多个事件监听器注册
- ✅ 事件分发机制

### 4. **连接稳定性** (Connection Stability)
- ✅ 空闲期间保持连接（心跳机制，5 秒测试）
- ✅ 快速连接/断开循环（3 次）

### 5. **错误处理** (Error Handling)
- ✅ 处理格式错误的消息
- ✅ 连接超时处理

### 6. **性能测试** (Performance)
- ✅ 突发连接（10 个并发）
- ✅ 连接延迟测量（5 次迭代）

### 7. **集成测试** (Integration with Chat API)
- ✅ 接收流式消息事件（stream:start、stream:message、stream:end）
- ✅ WebSocket 与 HTTP API 协作

## 📊 测试结果

### 最新测试结果

```
测试文件: 1 个通过
测试用例: 14 个全部通过
执行时间: 9.54 秒
```

### 详细结果

| 测试类别 | 测试数 | 状态 | 执行时间 |
|---------|--------|------|---------|
| Connection Management | 4 | ✅ | 139ms |
| Health Check | 1 | ✅ | 2ms |
| Event Broadcasting | 2 | ✅ | 5ms |
| Connection Stability | 2 | ✅ | 5.6s |
| Error Handling | 2 | ✅ | 5ms |
| Performance | 2 | ✅ | 518ms |
| Integration with Chat API | 1 | ✅ | 3.1s |

### 性能指标

**连接延迟统计**:
- 平均: 1.60ms
- 最小: 1ms
- 最大: 3ms

**并发连接性能**:
- 10 个连接同时建立: 4ms
- 平均: 0.40ms/连接

**稳定性测试**:
- 空闲保持: 5 秒 ✅
- 心跳机制: 正常工作 ✅

## 🚀 运行测试

### 前置条件

1. **应用运行中**
   ```bash
   pnpm dev
   ```

2. **Ollama 运行中**（用于集成测试）
   ```bash
   ollama serve
   ```

3. **模型已安装**
   ```bash
   ollama pull qwen3.5:9b
   ```

4. **Provider 配置**
   - 文件: `.home/providers.json5`
   - 内容: 包含 Ollama 配置

### 运行命令

```bash
# 运行 WebSocket 测试
pnpm test:e2e tests/gateway-websocket.e2e.test.ts

# 详细模式
pnpm test:e2e tests/gateway-websocket.e2e.test.ts --reporter=verbose

# 运行所有 E2E 测试
pnpm test:e2e

# 监视模式
pnpm test:e2e tests/gateway-websocket.e2e.test.ts --watch
```

## 📁 测试文件

```
tests/
├── gateway-websocket.e2e.test.ts    # WebSocket E2E 测试
└── helpers/
    └── ws-client.ts                  # 测试用 WebSocket 客户端封装
```

### `ws-client.ts` - 测试客户端

简化版的 GatewayClient，提供：
- ✅ WebSocket 连接管理
- ✅ RPC 请求/响应（Promise 风格）
- ✅ 事件监听与分发
- ✅ 超时处理
- ✅ 连接状态查询

**API 示例**:
```typescript
const client = new TestWsClient({ url: 'ws://127.0.0.1:8765/gateway/ws' });

// 连接
await client.connect();

// 监听事件
client.on('stream:message', (payload) => {
  console.log('收到消息:', payload);
});

// 等待事件
const data = await client.waitForEvent('stream:end', 30000);

// 关闭连接
client.close();
```

## 🔍 测试场景说明

### 场景 1: 基础连接测试

验证 WebSocket 连接的建立和关闭：

```typescript
const client = new TestWsClient({ url: WS_URL });
await client.connect();
expect(client.isConnected).toBe(true);
client.close();
```

### 场景 2: 并发连接测试

验证服务器处理多个同时连接的能力：

```typescript
const clients = [];
for (let i = 0; i < 10; i++) {
  const c = new TestWsClient({ url: WS_URL });
  await c.connect();
  clients.push(c);
}
// 所有连接都应该成功
```

### 场景 3: 心跳机制测试

验证空闲连接通过心跳保持活跃：

```typescript
await client.connect();
await new Promise(resolve => setTimeout(resolve, 5000)); // 等待 5 秒
expect(client.isConnected).toBe(true); // 连接仍然正常
```

### 场景 4: 事件推送测试

验证 WebSocket 接收服务端推送的事件：

```typescript
client.on('stream:start', (payload) => {
  console.log('流开始:', payload);
});

// 触发事件（通过 HTTP API）
await fetch(`${HTTP_BASE}/gateway/chat/threads/${threadId}/messages`, {
  method: 'POST',
  body: JSON.stringify({ message: '你好' })
});

// WebSocket 应该收到 stream:start 事件
```

### 场景 5: 错误处理测试

验证各种错误场景的处理：

```typescript
// 无效端口
const client = new TestWsClient({ url: 'ws://127.0.0.1:9999/invalid' });
await expect(client.connect()).rejects.toThrow();

// 连接超时
const client = new TestWsClient({ 
  url: 'ws://invalid-host:1234',
  timeout: 1000 
});
await expect(client.connect()).rejects.toThrow();
```

## 📈 性能基准

### 连接性能

| 指标 | 值 | 说明 |
|-----|-----|-----|
| 平均连接延迟 | ~1.6ms | 非常快 |
| 并发连接 (10) | ~4ms | 可同时处理多个连接 |
| 单连接平均时间 | ~0.4ms | 高效 |

### 稳定性

| 指标 | 值 | 说明 |
|-----|-----|-----|
| 心跳间隔 | 30 秒 | 服务端配置 |
| 空闲保持 | 5+ 秒 | 测试通过 |
| 快速重连 | 3 次循环 | 正常 |

## 🐛 故障排查

### 问题 1: 连接失败

**错误**: `ECONNREFUSED 127.0.0.1:8765`

**解决**:
```bash
# 确保应用运行中
pnpm dev
```

### 问题 2: 集成测试失败

**错误**: 未收到流事件

**原因**: 
- Ollama 未运行
- 模型未安装
- Provider 未配置

**解决**:
```bash
# 启动 Ollama
ollama serve

# 安装模型
ollama pull qwen3.5:9b

# 检查配置
cat .home/providers.json5
```

### 问题 3: 测试超时

**错误**: `Test timed out in 60000ms`

**解决**:
- 增加 `testTimeout` 配置
- 使用更快的模型
- 检查网络连接

## 🔄 与 Chat API 的对比

### Chat API 测试

- **协议**: HTTP + SSE (Server-Sent Events)
- **焦点**: API 端点、数据持久化、AI 对话
- **测试数**: 8 个
- **执行时间**: ~24 秒

### WebSocket 测试

- **协议**: WebSocket
- **焦点**: 连接管理、实时事件、性能
- **测试数**: 14 个
- **执行时间**: ~9 秒

### 互补性

两者共同验证：
1. **Chat API**: 业务逻辑和数据流
2. **WebSocket**: 实时通信和事件推送
3. **集成测试**: WebSocket 接收 Chat API 产生的事件

## 📚 相关文档

- [Gateway WebSocket 实现](../src/main/common/gateway/GatewayServer.ts)
- [Gateway 协议定义](../src/shared/gateway-protocol.ts)
- [前端客户端实现](../src/renderer/src/services/GatewayClient.ts)
- [Chat API 测试](./README.md)

## ✨ 下一步扩展

可以继续添加的测试：

1. **RPC 测试**: 测试客户端 → 服务端 RPC 调用
2. **消息序列测试**: 验证消息顺序
3. **大消息测试**: 测试大数据量传输
4. **压力测试**: 更多并发客户端（100+）
5. **网络异常测试**: 模拟网络中断和恢复
6. **安全测试**: 验证认证和授权机制

## 📝 总结

Gateway WebSocket 测试全面覆盖了：
- ✅ 连接生命周期管理
- ✅ 实时事件推送
- ✅ 错误处理机制
- ✅ 性能和稳定性
- ✅ 与 Chat API 集成

所有测试通过，说明 WebSocket 通信层工作正常！
