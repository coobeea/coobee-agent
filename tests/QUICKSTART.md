# 端到端测试快速开始

## 🚀 快速开始（3 步）

### 1. 启动测试服务器

```bash
# 方式 1: 使用脚本（推荐）
./tests/scripts/start-test-server.sh

# 方式 2: 手动启动
pnpm dev
```

应用会在 `http://127.0.0.1:8765` 启动。

### 2. 运行测试

打开新的终端窗口：

```bash
# 方式 1: 使用脚本（自动检查前置条件）
./tests/scripts/run-e2e.sh

# 方式 2: 直接运行
pnpm test:e2e
```

### 3. 查看结果

测试会输出详细的执行日志：

```
🚀 开始 Chat API 端到端测试
📍 目标地址: http://127.0.0.1:8765
🤖 测试模型: qwen3.5:9b

✓ Thread Management (3)
✓ Message Streaming (SSE) (2)
✓ Error Handling (3)

Test Files  1 passed (1)
     Tests  8 passed (8)
  Start at  17:50:00
  Duration  12.34s
```

## 📋 前置条件

### 必需

- Node.js 18+
- pnpm
- Ollama（本地 LLM）

### 安装 Ollama

**macOS**:
```bash
brew install ollama
ollama serve
```

**Linux**:
```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama serve
```

**Windows**:
从 [ollama.com](https://ollama.com) 下载安装包

### 安装模型

```bash
ollama pull qwen3.5:9b
```

## 🎯 测试场景

### 场景 1: 创建会话并发送消息

```bash
# 运行完整测试套件
pnpm test:e2e

# 输出示例：
# ✓ should create a new thread
# ✓ should send message and receive SSE stream
#   📤 发送消息: "请用一句话介绍你自己"
#   📥 接收 SSE 流...
#   我是你的智能助手，可以帮助你完成各种任务。
#   ✅ 执行完成
```

### 场景 2: 测试多轮对话

```bash
# 运行特定测试
pnpm test:e2e -t "multiple messages"

# 输出示例：
# ✓ should handle multiple messages in the same thread
#   📤 发送第一条消息: "你好"
#   📥 你好！有什么我可以帮助你的吗？
#   📤 发送第二条消息: "你的名字是什么？"
#   📥 我的名字是应用管家。
```

### 场景 3: 测试错误处理

```bash
# 测试错误情况
pnpm test:e2e -t "Error Handling"

# 输出示例：
# ✓ should return 404 for non-existent thread
# ✓ should return 400 for empty message
# ✓ should return 404 for message to non-existent thread
```

## 🔧 常用命令

```bash
# 运行所有端到端测试
pnpm test:e2e

# 以监视模式运行（修改代码自动重新运行）
pnpm test:e2e --watch

# 运行特定测试文件
pnpm test:e2e tests/chat-api.e2e.test.ts

# 运行匹配特定名称的测试
pnpm test:e2e -t "should create"

# 显示详细输出
pnpm test:e2e --reporter=verbose
```

## 🐛 故障排查

### 问题 1: 应用未启动

```
❌ Error: connect ECONNREFUSED 127.0.0.1:8765
```

**解决**:
```bash
# 启动应用
pnpm dev
```

### 问题 2: Ollama 未运行

```
❌ Error: connect ECONNREFUSED 127.0.0.1:11434
```

**解决**:
```bash
# 启动 Ollama
ollama serve
```

### 问题 3: 模型未安装

```
❌ Error: 404 model 'qwen3.5:9b' not found
```

**解决**:
```bash
# 安装模型
ollama pull qwen3.5:9b

# 查看已安装的模型
ollama list
```

### 问题 4: 测试超时

```
❌ Error: Test timed out in 60000ms
```

**解决**:
- 方案 1: 使用更小的模型
  ```bash
  # 修改测试文件中的模型为更小的版本
  overrideModel: 'qwen2.5:0.5b'
  ```
- 方案 2: 增加超时时间
  ```typescript
  // 在测试文件中
  it('should ...', async () => {
    // 测试代码
  }, 120000); // 增加到 120s
  ```

## 📊 查看测试数据

测试完成后，可以查看持久化的数据：

```bash
# 查看会话列表
ls .home/threads/

# 查看会话消息
cat .home/workspaces/*/sessions/*.jsonl

# 查看事件日志
cat .home/workspaces/*/.runtime/events/events.jsonl
```

## 🧹 清理测试数据

```bash
# 清理所有测试数据
rm -rf .home/workspaces/*
rm -rf .home/threads/*

# 或使用脚本
./tests/scripts/clean-test-data.sh  # 如果创建了这个脚本
```

## 📝 编写自己的测试

1. 在 `tests/` 目录创建 `*.e2e.test.ts` 文件
2. 使用 vitest 编写测试用例
3. 运行测试验证

示例：

```typescript
// tests/my-feature.e2e.test.ts
import { describe, it, expect } from 'vitest';

describe('My Feature E2E', () => {
  it('should work correctly', async () => {
    // 1. 准备数据
    const response = await fetch('http://127.0.0.1:8765/gateway/...');
    
    // 2. 执行操作
    const data = await response.json();
    
    // 3. 验证结果
    expect(data.success).toBe(true);
  });
});
```

## 🚀 下一步

- 阅读 [完整测试文档](./README.md)
- 查看 [Chat API 设计文档](../docs/01-designs/05-chat-api-data-flow.md)
- 探索 [源代码](../src/main/routes/ChatRoutes.ts)

## 💡 提示

- 测试前确保没有其他程序占用 8765 端口
- 使用 `--watch` 模式可以快速迭代开发
- 测试日志会输出详细的 SSE 流内容，便于调试
- 可以同时运行多个测试，验证并发场景
