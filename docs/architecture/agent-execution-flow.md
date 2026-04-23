# Agent 执行流程

> 最后更新：2026-04-22

本文档详细描述了 coobee-agent 中从接收用户消息到完成推理的完整执行流程。

## 概述

coobee-agent 采用 **"消息驱动 + 无状态实例"** 架构：
- 每次用户请求触发完整的 "创建 → 推理 → 销毁" 流程
- Runtime 对象用完即丢，由 GC 回收
- 会话连续性靠 JSONL 文件持久化（SDK 自动管理）

### 运行模式

执行流程支持两种模式：

1. **标准模式（Standard）**：完整的工作区、扩展、Skill 系统支持，适用于 Agent 模式和复杂任务。
2. **轻量模式（Lightweight）**：跳过环境注入、扩展加载、历史记录等，仅保留核心推理能力，适用于对话式 AI 和快速推理场景。

轻量模式通过 `builder.lightweight(true)` 启用。

## 核心组件

| 组件 | 职责 |
|------|------|
| `ChatRoutes` / Gateway | API 层，接收 HTTP 请求，调用 AgentExecutor |
| `AgentExecutor` | 执行调度层，管理并发、生命周期、事件分发 |
| `AgentEnvInjector` | 环境注入，构建 AgentEnv、注入运行时路径、Skill 发现提示 |
| `ExtensionManager` | 扩展系统，触发前置/后置 Hook |
| `AgentBuilder` | 构建器（PiMonoBuilder / OpenAIBuilder） |
| `AgentRuntime` | 运行时接口（PiMonoAgentRuntime / OpenAIAgentRuntime） |
| `pi-coding-agent SDK` | 底层 LLM 交互 SDK |
| `StreamEmitter` | 流式事件发射器，广播到 EventBus |
| `StreamConsumersManager` | 管理流式事件消费者（HistoryWriter、EventWriter 等） |

---

## 完整执行流程

### 阶段 1：接收请求与并发检查

**触发点**：API 层（如 `ChatRoutes.sendMessage`）调用 `agentExecutor.submit()` 或 `agentExecutor.stream()`。

#### 1.1 并发锁检查
```typescript
// AgentExecutor.submit() / stream()
if (this.sessionStatus.isRunning(sessionId)) {
  return { status: 'busy', sessionId };
}
```

- 检查 `sessionStatus`，如果当前 `sessionId` 正在运行（Busy），直接拒绝请求。
- **设计目的**：保证同一个会话串行执行，避免并发冲突。

#### 1.2 注册运行状态
```typescript
this.sessionStatus.register(sessionId);
```

- 将 `sessionId` 标记为运行中，防止其他请求并发干扰。
- 注册后进入 `executePipeline()` 开始实际执行。

---

### 阶段 2：环境准备与扩展 Hook

**入口**：`AgentExecutor.executePipeline()`

**注意**：以下步骤在轻量模式（`lightweight = true`）下会被跳过，直接进入阶段 3。轻量模式用于快速推理场景（如对话式 AI），不需要完整的工作区和扩展支持。

#### 2.0 加载任务级 Extension
```typescript
// 检查是否轻量模式
const isLightweight = builder ? (builder.getLightweight?.() ?? false) : false;

if (!isLightweight) {
  // 加载任务级 Extension（如果存在）
  await loader.loadWorkspaceExtensions(sessionId, workspaceDir);
}
```

- 如果不是轻量模式，在环境注入前先加载 Workspace 级的扩展。
- 这些扩展可能会提供额外的 Skill 目录、工具或指令注入。

#### 2.1 环境注入
```typescript
const workspace = await injectEnv(sessionId, builder);
```

- 调用 `AgentEnvInjector.injectEnv()` 完成：
  - 获取/创建当前 Agent 的工作区目录（Workspace）。
  - 初始化 Agent Home（如果有 agentId）。
  - 构建 AgentEnv（运行时环境对象，包含所有路径和系统信息）。
  - **仅在 Agent 模式下**：扫描 Skill 并注入以下内容到 `builder.appendInstructions()`：
    - 运行时路径块（`runtimePathsBlock`）：让 AI 了解工作空间、Skill 目录、Extension 目录等。
    - AGENTS.md 文件内容（如果存在）。
    - Agent Home 的可注入文件（如 README.md、使用说明等）。
    - 工作区上下文文件（如 .coobee/context.md）。
    - Extension 运行时注入的指令。
    - Skill 发现提示（按需加载机制，教 AI 如何使用 `skill_list` 和 `read` 工具）。
  - 设置会话存储目录、工作目录、沙箱上下文。

#### 2.2 记录用户消息
```typescript
streamConsumersManager.writeUserMessage(sessionId, message);
```

- 将用户发来的 `message` 写入本地历史记录文件 `history.jsonl`。
- 持久化用户输入，供后续审计和上下文恢复使用。

#### 2.3 触发前置扩展 Hook
```typescript
await this.runExtensionHooks(sessionId, message, builder);
```

依次触发扩展的钩子：
1. **`message_received`**：通知扩展收到新消息。
2. **`session_start`**：通知扩展会话开始（新会话或恢复会话）。
3. **`before_agent_start`**：Agent 启动前最后的修改机会，扩展可以：
   - 通过 `prependContext` 追加上下文（如团队规范、项目约定）。
   - 通过 `replaceSystemPrompt` 完全替换系统提示词。

**扩展注入示例**：
```typescript
// Extension Hook: before_agent_start
return {
  prependContext: "请遵循团队编码规范：使用 TypeScript 严格模式...",
  replaceSystemPrompt: undefined // 不替换，仅追加
};
```

---

### 阶段 3：构建运行时实例

**入口**：`builder.build()` → `PiMonoAgentRuntime.initialize()`

#### 3.1 调用 Builder
```typescript
runtime = await builder.sessionId(sessionId).build();
```

- 执行 Builder 的 `build()` 方法，创建具体的运行时实例（如 `PiMonoAgentRuntime`）。

#### 3.2 初始化 Runtime (PiMonoAgentRuntime 为例)
```typescript
// PiMonoAgentRuntime.initialize()
async initialize(): Promise<void> {
  // 1. 构造 OpenAI 兼容的 Model 对象
  const model = createOpenAICompatModel(modelName, baseURL, modelMeta);
  
  // 2. 配置认证存储（AuthStorage）
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(CUSTOM_PROVIDER, apiKey);
  
  // 3. 配置会话管理器（SessionManager）
  const sessionManager = SessionManager.continueRecent(cwd, sessionDir);
  
  // 4. 配置设置管理器（SettingsManager）
  const settingsManager = SettingsManager.inMemory({ compaction, retry });
  
  // 5. 合并工具列表（内置工具 + 自定义工具）
  const allSdkTools = [
    ...(sdkTools || []),
    ...convertTools(tools || [], { sandboxContext, log, getSignal })
  ];
  
  // 6. 调用底层 SDK 创建 AgentSession
  const { session } = await createAgentSession({
    cwd, model, thinkingLevel,
    authStorage, modelRegistry, sessionManager, settingsManager,
    resourceLoader, customTools: allSdkTools, tools: []
  });
  
  this.piSession = session;
}
```

**关键步骤**：
- **Model 构造**：手动创建 `openai-completions` 格式的 Model 对象，指向 MiniMax / DeepSeek 等兼容后端。
- **工具转换**：将统一的 `ToolDefinition` 转换为 SDK 原生的 `PiToolDefinition` 格式。
- **会话模式**：
  - `file` 模式：持久化到 `workspace/sessions/` 目录。
  - `memory` 模式：仅内存存储，适用于测试。

#### 3.3 创建事件发射器
```typescript
emitter = this.createEmitter(sessionId, runtime);
```

- 创建 `StreamEmitter` 实例，用于后续将流式事件广播到全局 EventBus。
- EventBus 的消费者包括：
  - `HistoryWriter`：写入 `history.jsonl`
  - `EventWriter`：写入 `event-logs.jsonl`
  - `StreamMonitor`：性能监控

#### 3.4 发送启动事件
```typescript
await this.emitAgentLifecycleEvent('agent:start', {
  sessionId, agentId, agentName, task: message.substring(0, 200)
});
```

- 向 EventBus 发送 `agent:start` 生命周期事件，通知所有监听器 Agent 已启动。

---

### 阶段 4：流式推理与事件分发

**入口**：`runtime.stream(message)` → `consumeAndForward()`

#### 4.1 启动推理
```typescript
const gen = runtime.stream(message, { signal });
```

- 调用 Runtime 的 `stream()` 方法，返回一个 AsyncGenerator。
- AsyncGenerator 会逐个 yield 流式事件块（StreamChunk）。

#### 4.2 底层事件订阅 (PiMonoAgentRuntime 内部)
```typescript
// PiMonoAgentRuntime.doStream()
const unsubscribe = setupEventSubscription(
  this.piSession,
  {
    onChunk: (chunk) => queue.push(chunk),
    onTextDelta: (text) => { fullOutput += text; },
    toolCalls,
    onApiError: (errorMessage) => { apiError = errorMessage; }
  },
  log
);

// 触发 SDK 推理
this.piSession.prompt(input)
  .then(() => {
    unsubscribe();
    queue.push({ type: 'run:done', content: '' });
    queue.end();
  })
  .catch((err) => {
    unsubscribe();
    queue.push({ type: 'run:error', content: err.message });
    queue.end();
  });
```

**关键机制**：
- **事件订阅**：通过 `setupEventSubscription` 监听 SDK 的回调事件（如 `text_delta`, `tool_call`, `reasoning_delta`）。
- **队列桥接（ChunkQueue）**：将 SDK 的推送式回调（callback）转换为拉取式迭代器（AsyncGenerator）。
- **事件类型**：
  - `run:start`：推理开始
  - `turn:start` / `turn:done`：推理轮次边界
  - `llm:start` / `llm:done`：LLM 调用边界
  - `text:delta`：文本增量
  - `reasoning:delta`：思考内容增量
  - `tool:start` / `tool:progress` / `tool:done`：工具调用生命周期
  - `run:done` / `run:error`：推理结束

#### 4.3 统一分发循环 (`consumeAndForward`)
```typescript
private async *consumeAndForward(
  gen: AsyncGenerator<StreamChunk>,
  emitter: IStreamEmitter,
  sessionId: string,
  onChunk?: (chunk: StreamChunk) => void,
  signal?: AbortSignal
): AsyncGenerator<StreamChunk, ExecutionResult> {
  
  let r = await gen.next();
  while (!r.done) {
    // 检测中止信号
    if (signal?.aborted) {
      const interruptedChunk = { type: 'run:interrupted', content: 'Cancelled by user' };
      emitter.forward(interruptedChunk);
      onChunk?.(interruptedChunk);
      yield interruptedChunk;
      await gen.return({ output: '', error: 'Aborted by user' });
      return { output: '', error: 'Aborted by user' };
    }
    
    const chunk = r.value;
    
    // 1. 广播到 EventBus
    emitter.forward(chunk);
    
    // 2. 更新检查点（会话状态）
    this.updateCheckpoint(sessionId, chunk);
    
    // 3. 触发 Extension Hook（如人工审批）
    fireHooks(chunk, sessionId, { getTurnStartTime, getTurnToolCallCount }, agentId);
    
    // 4. 记录指标
    recordMetrics(chunk, sessionId);
    
    // 5. 透传给前端
    onChunk?.(chunk);
    yield chunk;
    
    r = await gen.next();
  }
  
  return r.value as ExecutionResult;
}
```

**对于每一个事件块（Chunk），执行 4 个操作**：

1. **透传给前端**：
   - 通过 `yield` 将 Chunk 返回给 API 层。
   - API 层（如 `ChatRoutes`）通过 SSE 发送给客户端。

2. **广播到 EventBus**：
   - 调用 `emitter.forward(chunk)` 将事件广播到全局 EventBus。
   - 消费者自动接收并处理（如写入历史记录、更新 UI 状态）。

3. **更新检查点**：
   - 调用 `updateCheckpoint()` 根据事件类型更新当前会话状态：
     - `tool:start` → `tool-pending`
     - `tool:done` → `running`
     - `run:error` → `error`
     - `run:done` → `completed`
   - 同步更新 `ThreadStore` 的 `runStatus`，供前端查询。

4. **触发执行中 Hook**：
   - 调用 `fireHooks()`，触发扩展的工具拦截 Hook（如 `before_tool_call`）。
   - 典型用例：人工审批高危命令（如 `rm -rf`）。

5. **记录指标**：
   - 调用 `recordMetrics()` 记录性能指标（如推理耗时、工具调用次数）。

#### 4.4 中止信号处理
```typescript
// 监听 AbortSignal
if (signal?.aborted) {
  log.info(`Aborted: sessionId=${sessionId}`);
  
  // 发送 run:interrupted 事件
  const interruptedChunk = { type: 'run:interrupted', content: 'Cancelled by user' };
  emitter.forward(interruptedChunk);
  yield interruptedChunk;
  
  // 终止 Generator
  await gen.return({ output: '', error: 'Aborted by user' });
  return { output: '', error: 'Aborted by user' };
}
```

- 在循环中持续检测 `signal.aborted`。
- 如果用户取消，立即：
  - 发送 `run:interrupted` 事件。
  - 调用 `gen.return()` 提前终止推理。
  - 返回中止结果。

#### 4.5 推理完成
```typescript
// SDK 推理结束后
return {
  output: fullOutput,
  error: apiError || undefined,
  toolCalls,
  duration: Date.now() - startTime,
  metadata: { agentId, sessionId },
  rawApiRequest
};
```

- 返回完整的 `ExecutionResult`，包含：
  - `output`：最终文本输出。
  - `toolCalls`：所有工具调用记录。
  - `duration`：总耗时。
  - `rawApiRequest`：原始 API 请求体（供审计）。

---

### 阶段 5：销毁与清理

**入口**：`finally` 块（无论成功或失败都会执行）

#### 5.1 触发后置扩展 Hook
```typescript
await this.runExtensionEndHooks(sessionId, agentId, result, duration);
```

依次触发：
1. **`agent_end`**：Agent 执行结束，传递执行结果和耗时。
2. **`session_end`**：会话结束（单次请求级别的会话，非长期会话）。

**扩展用例**：
- 记录执行日志到外部系统。
- 发送通知（如 Slack、邮件）。
- 清理临时资源。

#### 5.2 发送结束事件
```typescript
await this.emitAgentLifecycleEvent('agent:done', {
  sessionId,
  agentId,
  agentName,
  success: true,
  durationMs: duration,
  summary: result.output.substring(0, 500)
});
```

- 向 EventBus 发送 `agent:done` 生命周期事件。
- 包含执行结果摘要、成功状态和耗时。

#### 5.3 清理会话缓存
```typescript
SkillManager.clearSession(sessionId);
streamConsumersManager.clearSession(sessionId);
```

- 清理 `SkillManager` 的会话级 Skill 缓存。
- 清理 `streamConsumersManager` 的监听器缓存。

#### 5.4 卸载任务级扩展
```typescript
if (loader) {
  await loader.unloadWorkspaceExtensions(sessionId);
}
```

- 卸载任务级（Workspace 级）扩展。
- 释放扩展占用的资源（如文件监听器、定时器）。

#### 5.5 销毁 Runtime 实例
```typescript
await this.destroyRuntime(runtime);
```

- 调用 `runtime.destroy()` 销毁底层 SDK 的 Session 实例。
- 实例用完即丢，由垃圾回收处理。
- 会话状态已持久化到 JSONL 文件，无需手动保存。

#### 5.6 释放并发锁
```typescript
this.sessionStatus.unregister(sessionId);
```

- 将 `sessionStatus` 中的该 `sessionId` 注销。
- 允许下一次请求进入，恢复并发能力。

---

## 关键设计模式

### 1. 消息驱动架构
- 每条用户消息触发完整的 "创建 → 推理 → 销毁" 流程。
- 无需维护长期运行的 Agent 实例。

### 2. 无状态实例 + 有状态存储
- **无状态实例**：Runtime 对象用完即丢，由 GC 回收。
- **有状态存储**：会话连续性靠 JSONL 文件持久化（SDK 自动管理）。

### 3. 双通道事件分发
- **拉取模式**：AsyncGenerator `yield` 流式块，供 SSE 透传。
- **推送模式**：`StreamEmitter` 广播到 EventBus，供多个消费者订阅。

### 4. 队列桥接（Push-Pull Bridge）
- **问题**：SDK 通过回调（callback）推送事件，API 层需要拉取式迭代器（AsyncGenerator）。
- **解决**：`ChunkQueue` 作为中间层，将推送转换为拉取。

### 5. Extension Hook 分层
- **前置 Hook**：`message_received` → `session_start` → `before_agent_start`
- **执行中 Hook**：`before_tool_call` → `after_tool_call`
- **后置 Hook**：`agent_end` → `session_end`

### 6. 并发控制
- 通过 `SessionStatusManager` 实现同一会话串行执行。
- 不同会话之间可以并发执行。

---

## 事件时序图

```
用户发送消息
    ↓
API 层 (ChatRoutes)
    ↓
AgentExecutor.submit() / stream()
    ↓
[并发锁] sessionStatus.register(sessionId)
    ↓
executePipeline()
    ↓
┌─────────────────────────────────────────────────┐
│ 阶段 2: 环境准备与扩展 Hook                         │
│  - injectEnv() (注入工作区、运行时路径、Skill 提示)      │
│  - writeUserMessage() (记录用户消息)                │
│  - runExtensionHooks() (前置 Hook)                │
└─────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────┐
│ 阶段 3: 构建运行时实例                              │
│  - builder.build()                               │
│  - PiMonoAgentRuntime.initialize()              │
│    - 构造 Model 对象 (OpenAI 兼容格式)             │
│    - 配置 AuthStorage / SessionManager            │
│    - 转换工具列表                                  │
│    - createAgentSession() (SDK)                  │
│  - createEmitter()                               │
│  - emit('agent:start')                           │
└─────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────┐
│ 阶段 4: 流式推理与事件分发                          │
│  runtime.stream(message)                         │
│    ↓                                             │
│  setupEventSubscription() (订阅 SDK 事件)         │
│    ↓                                             │
│  piSession.prompt(input) (触发推理)               │
│    ↓                                             │
│  [循环] consumeAndForward()                      │
│    - SDK 事件 → ChunkQueue.push()                │
│    - queue 拉取 → yield StreamChunk              │
│    - emitter.forward() (广播到 EventBus)         │
│    - updateCheckpoint() (更新状态)               │
│    - fireHooks() (执行中 Hook)                   │
│    - recordMetrics() (记录指标)                  │
│    - yield chunk (透传给前端 SSE)                │
│    ↓                                             │
│  推理完成 → return ExecutionResult               │
└─────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────┐
│ 阶段 5: 销毁与清理                                 │
│  - runExtensionEndHooks() (后置 Hook)            │
│  - emit('agent:done')                            │
│  - SkillManager.clearSession()                   │
│  - streamConsumersManager.clearSession()         │
│  - loader.unloadWorkspaceExtensions()            │
│  - runtime.destroy()                             │
│  - sessionStatus.unregister(sessionId)           │
└─────────────────────────────────────────────────┘
    ↓
返回结果给用户
```

---

## 常见场景

### 场景 1：用户取消执行
```typescript
// 前端发送 AbortSignal
const controller = new AbortController();
agentExecutor.stream({ ..., signal: controller.signal });

// 用户点击取消按钮
controller.abort();

// AgentExecutor 检测到 abort 信号
// → 发送 run:interrupted 事件
// → 调用 gen.return() 终止推理
// → 返回中止结果
```

### 场景 2：工具需要人工审批
```typescript
// Extension Hook: before_tool_call
async onBeforeToolCall({ toolName, params }) {
  if (toolName === 'exec' && params.command.includes('rm -rf')) {
    // 弹出审批对话框
    const approved = await showApprovalDialog(params);
    if (!approved) {
      return { abort: true, reason: 'User rejected dangerous command' };
    }
  }
  return { abort: false };
}
```

### 场景 3：API 错误重试
```typescript
// SettingsManager 配置
const settingsManager = SettingsManager.inMemory({
  retry: {
    enabled: true,
    maxRetries: 3,
    baseDelayMs: 1000
  }
});

// SDK 自动重试
// - 429 (Rate Limit)
// - 500 (Internal Server Error)
// - 503 (Service Unavailable)
```

---

## 扩展阅读

- [AgentEnvInjector 实现](./append-instructions-content.md)：环境注入与运行时路径注入
- [Skill 按需加载机制](./core-skills-injection.md)：Skill 发现提示与 read 工具联动
- [Extension Hook 系统](../01-designs/extension-hooks.md)：扩展钩子的生命周期和用法
- [工具系统架构](../../src/main/agent/tools/README.md)：工具定义与转换机制
