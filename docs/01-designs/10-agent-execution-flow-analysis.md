# Agent 执行流程与双运行时架构分析

> 日期：2026-04-19
> 版本：v1.0
> 状态：📝 设计中 (分析报告)

## 概述
本文档详细分析了 Coobee Agent 中 `AgentExecutor` 的整体执行流程，以及底层双运行时（`PiMonoAgentRuntime` 和 `OpenAIAgentRuntime`）的架构设计。同时，指出了当前代码库中存在的设计缺陷、抽象泄漏和执行流不一致的问题，为后续的重构提供依据。

## 一、 整体执行流程 (AgentExecutor)

`AgentExecutor` 是连接 API 请求与底层大模型运行时的调度中心。无论是通过 `submit()` 还是 `stream()` 发起的请求，其核心生命周期如下：

### 1. 状态注册与并发控制
- 检查 `SessionStatusManager`，如果当前 `sessionId` 正在运行，则拒绝请求（Busy 锁），保证同一会话的串行执行。
- 注册会话状态为 `running`，并分配 `AbortController` 用于支持中断。

### 2. 环境准备与依赖注入
- 获取或创建 Agent 的专属工作区目录（`workspaceDir`）。
- 加载任务级扩展（`ExtensionManager.loadWorkspaceExtensions`）。
- 调用 `injectEnv()` 注入运行时环境（如文件系统权限、环境变量、工具集）。
- 初始化 `AgentEventWriter`，负责将后续产生的所有事件持久化到 `.jsonl` 文件。

### 3. 前置生命周期钩子 (Pre-Hooks)
- 依次触发扩展系统的 Void Hooks：`message_received`、`session_start`。
- 触发 Modifying Hook：`before_agent_start`（允许扩展动态修改 Prompt 或追加上下文）。

### 4. 构建 Runtime 实例
- 调用 `builder.build()` 创建具体的 `AgentRuntime` 实例（如 `PiMono` 或 `OpenAI`）。
- 注册统一事件分发器（`EventWriter` 绑定 `StreamEmitter`）。
- 发送 `agent:start` 生命周期事件到全局 EventBus。

### 5. 流式推理与事件分发 (The Stream Loop)
- 调用 `runtime.stream(message)` 启动大模型推理，返回 `AsyncGenerator<StreamChunk>`。
- 进入消费循环（`consumeAndForward`）：
  - 逐个拉取 `StreamChunk`。
  - **统一分发**：通过 `eventWriter.dispatch(chunk)` 写入文件并广播到 WebSocket。
  - **状态更新**：根据 `tool:start`、`tool:done` 等事件实时更新会话状态。
  - **过程钩子**：触发 `turn_start`、`turn_end`、`before_compaction` 等过程 Hook。

### 6. 清理与销毁 (Teardown)
- 触发后置钩子：`agent_end`、`session_end`。
- 发送 `agent:done` 生命周期事件。
- 注销 `EventWriter`，调用 `runtime.destroy()` 释放底层资源。
- 卸载任务级扩展，解除 `SessionStatusManager` 的 Busy 锁。

---

## 二、 双运行时架构分析 (Dual Runtime Architecture)

系统目前支持两种底层运行时，它们都继承自 `AbstractAgentRuntime`。

### 1. PiMonoAgentRuntime (`piMono`)
- **定位**：高级代码 Agent 引擎，基于 `@earendil-works/pi-coding-agent` SDK。
- **特点**：
  - **自定义模型对象**：手动构造 `openai-completions` 兼容的 Model 对象，支持任意 OpenAI 兼容的 API（如 DashScope、DeepSeek）。
  - **高级事件流**：支持独立的 `thinking_delta`（思考流）和 `tool_execution_update`（工具执行进度）。
  - **内置会话管理**：SDK 内部接管了上下文压缩（Compaction）和错误重试（Retry）。
  - **事件桥接**：使用 `ChunkQueue` 将 SDK 的回调式事件（Push）转换为 `AsyncGenerator` 的拉取式事件（Pull）。

### 2. OpenAIAgentRuntime (`openai`)
- **定位**：标准对话 Agent 引擎，基于 `@openai/agents` SDK。
- **特点**：
  - **纯参数驱动**：直接传递 instructions 和 tools 给 SDK。
  - **FileSession 持久化**：自定义 `FileSession` 实现 JSONL 格式的上下文存储。
  - **ThinkTag 解析**：由于标准 OpenAI 协议不支持独立的思考流，运行时内部使用 `ThinkTagParser` 实时拦截并剥离 `<think>` 标签，转换为前端友好的 `reasoning` 事件。
  - **手动压缩控制**：通过 `SessionCompressor` 手动管理上下文截断和摘要。

---

## 三、 现有架构问题与缺陷分析 (Issues & Flaws)

在深入分析上述流程和通用层（`AbstractAgentRuntime`）后，发现以下几个严重的设计问题和抽象泄漏：

### 1. `AgentExecutor` 中的执行流重复与不一致 (Duplication & Inconsistency)
- **问题描述**：`AgentExecutor` 中存在 `execute()` 和 `stream()` 两个核心方法。`execute()` 包含了完整的生命周期（Pre-Hooks、Post-Hooks、`consumeAndForward` 统一循环），而 `stream()` 却**手动复制**了 `execute()` 的大部分逻辑，但**遗漏了关键的扩展钩子**（如 `message_received`、`session_start`、`agent_end` 等）。
- **影响**：如果上层直接调用 `stream()`，会导致扩展系统（Extensions）的生命周期钩子失效，破坏了插件生态的完整性。
- **根本原因**：缺乏对“流式执行管道”的统一抽象，导致代码散落和维护困难。

### 2. 通用层 (`AbstractAgentRuntime`) 的抽象泄漏 (Abstraction Leak)
- **问题描述**：基类 `AbstractAgentRuntime` 负责提供通用的 `stream()` 包装和错误恢复机制。但在其 `buildRecoveryRuntime()` 方法中，出现了极其危险的代码：
  ```typescript
  const self = this as any;
  const compressor = self.sessionCompressor;
  const thinkingLevel = self.options?.thinkingLevel;
  ```
- **影响**：基类强行去读取子类（`OpenAIAgentRuntime`）特有的属性（`sessionCompressor`）。这严重破坏了面向对象设计的开闭原则（OCP）。如果未来新增一个不使用 `sessionCompressor` 的运行时，基类的逻辑就会变得脆弱且难以理解。

### 3. HITL (Human-in-the-Loop) 职责混乱
- **问题描述**：`AbstractAgentRuntime` 接口定义了 `approveToolCall`、`rejectToolCall` 和 `resumeStream` 方法，但基类的默认实现是直接 `throw new Error`。而在 `OpenAIAgentRuntime` 的注释中明确写道：“HITL 审批现在由 tool-approval Extension 在 before_tool_call Hook 中处理”。
- **影响**：既然 HITL 已经完全交由扩展系统（Extension）在管道层面拦截处理，那么 Runtime 接口就不应该再包含这些废弃的方法。这属于接口污染。

### 4. `PiMonoAgentRuntime` 的异步队列潜在风险 (Async Queue Risk)
- **问题描述**：在 `PiMonoAgentRuntime.doStream` 中，使用了 `ChunkQueue`。SDK 的执行 `this.piSession.prompt(input)` 被包装在一个 `Promise.then` 中向队列 `push` 数据，而主线程通过 `for await (const chunk of queue)` 拉取数据。
- **影响**：如果外部传入了 `AbortSignal` 导致生成器提前 `return`，或者主线程发生异常，后台的 `piSession.prompt` Promise 可能仍在继续执行并向一个已关闭的队列推送数据，可能导致内存泄漏或未捕获的 Promise 异常（Unhandled Rejection）。

## 结论
当前的双运行时架构在概念上是清晰的，但在**执行管道的一致性**和**基类的抽象边界**上存在明显的技术债务。后续的重构应重点关注：
1. 合并 `AgentExecutor` 中的 `execute` 和 `stream` 逻辑，确保所有请求经过统一的 Hook 管道。
2. 修复 `AbstractAgentRuntime` 的抽象泄漏，通过接口或配置注入的方式处理错误恢复，而不是使用 `as any` 强读子类属性。
3. 清理 Runtime 接口中废弃的 HITL 方法。
