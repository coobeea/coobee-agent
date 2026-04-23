# Agent 执行流程

> 最后更新：2026-04-23

本文档描述 `src/main/agent` 从接收 Thread 消息到完成 Runtime 推理、事件分发、持久化和清理的主链路。

## 1. 总览

当前 Agent 执行链路采用 **消息驱动 + 短生命周期 Runtime + 文件持久化会话** 的模型：

- 每次用户消息都会触发一次完整的 `builder -> runtime -> stream -> destroy` 流程。
- Runtime 实例不长期驻留，执行结束后销毁。
- Thread 元数据、SDK 会话、前端历史、调试事件分别持久化，避免单一文件承担过多语义。
- P1 后统一要求 Runtime 只产出 `StreamChunk`，事件广播由 `AgentExecutor` 负责。

核心链路：

```text
ChatRoutes / ThreadWaker
  -> ThreadExecutionFactory.createBuilder()
  -> AgentExecutor.stream() / submit()
  -> AgentEnvInjector.injectEnv()
  -> Extension start hooks
  -> builder.build()
  -> runtime.stream()
  -> AgentExecutor.consumeAndForward()
  -> StreamEmitter.forward()
  -> EventBus
  -> StreamConsumers(EventWriter / HistoryWriter / StreamMonitor)
  -> Extension end hooks
  -> runtime.destroy()
```

## 2. 核心组件

| 组件                     | 职责                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `ChatRoutes`             | 接收前端 Thread 消息请求，并把 Thread 交给执行层                                                          |
| `ThreadWaker`            | 自动化/恢复场景下唤醒 Thread 并提交恢复消息                                                               |
| `ThreadExecutionFactory` | 根据 Thread + Agent 统一创建 Runtime Builder                                                              |
| `AgentContextResolver`   | 统一解析 agentHome、dataDirectory、workspace、sessionDir、effectiveModel                                  |
| `AgentExecutor`          | 并发锁、Abort、生命周期事件、扩展 Hook、事件转发和清理                                                    |
| `AgentEnvInjector`       | 注入 workspace、AgentEnv、Skill、工具、沙箱上下文和 prompt 附加块                                         |
| `PromptAssemblyService`  | 统一装配 runtime paths、AGENTS.md、Agent Home、workspace context、Skill discovery、Extension instructions |
| `AgentBuilder`           | Runtime 构建器，目前包括 `PiMonoBuilder` 和 `OpenAIBuilder`                                               |
| `AgentRuntime`           | SDK 适配层，统一以 `AsyncGenerator<StreamChunk>` 输出事件                                                 |
| `StreamEmitter`          | 将 `StreamChunk` 转成 EventBus 事件                                                                       |
| `StreamConsumersManager` | 管理 EventWriter、HistoryWriter、StreamMonitor 等消费者                                                   |
| `AgentEventWriter`       | 已废弃的兼容适配层，仅用于 Extension API 转发到 EventBus                                                  |

## 3. 标准执行流程

### 3.1 接收请求并创建 Builder

标准聊天路径由 `ChatRoutes` 触发，恢复路径由 `ThreadWaker` 触发。P1 后两者都不再各自拼 Builder，而是统一走：

```typescript
const builder = await ThreadExecutionFactory.getInstance().createBuilder({
  threadId,
  sessionMode: 'file'
});
```

`ThreadExecutionFactory` 会负责：

- 读取 Thread 元数据。
- 读取 Agent 定义。
- 调用 `AgentContextResolver.resolve()` 得到运行期上下文。
- 设置 `sessionMode`、`name`、`instructions`、`applyProviderConfig`。
- 处理空字符串 model / instructions，避免把无效配置传入 Runtime。

这一步解决了 P0/P1 中 ChatRoutes 和 ThreadWaker 配置不一致的问题。

### 3.2 进入 AgentExecutor

`AgentExecutor.stream()` / `submit()` 先做同一会话的并发保护：

```typescript
if (this.sessionStatus.isRunning(sessionId)) {
  return { status: 'busy', sessionId };
}
this.sessionStatus.register(sessionId);
```

随后进入 `executePipeline()`：

```text
executePipeline()
  -> load workspace extensions
  -> injectEnv()
  -> write user message
  -> run extension start hooks
  -> build runtime
  -> stream and forward chunks
  -> run extension end hooks
  -> cleanup
```

轻量模式 `builder.lightweight(true)` 会跳过环境注入、扩展加载和历史写入，仅保留核心推理能力。

### 3.3 环境注入

`AgentEnvInjector.injectEnv()` 负责把运行前上下文写进 Builder，但 P1 后不再内联所有 prompt 拼装细节：

```text
AgentEnvInjector
  -> AgentContextResolver.resolve()
  -> build AgentEnv
  -> SkillManager.scanSkills()
  -> PromptAssemblyService.assemble()
  -> builder.appendInstructions(...)
  -> builder.skills(...)
  -> builder.tools(...)
  -> builder.sandboxContext(...)
  -> builder.sessionDir/workspaceRoot/contextDir(...)
```

`PromptAssemblyService` 固定 prompt 附加块顺序：

1. `runtime_paths`
2. `agents_md`
3. `agent_home`
4. `workspace_context`
5. `skill_discovery`
6. `extension_instruction_N`

默认大小限制：

| 块                     | 默认限制   |
| ---------------------- | ---------- |
| Agent Home             | 10000 字符 |
| AGENTS.md              | 50000 字符 |
| Workspace context 总量 | 6000 字符  |
| Workspace 单文件       | 3000 字符  |

### 3.4 Extension Hook 时机

当前扩展点不是只有“开始”和“结束”两个时机，而是分三类：

| 阶段   | Hook                                                        | 作用                                     |
| ------ | ----------------------------------------------------------- | ---------------------------------------- |
| 启动前 | `message_received` / `session_start` / `before_agent_start` | 注入上下文、替换 system prompt、记录启动 |
| 执行中 | `before_tool_call` / `after_tool_call`                      | 工具调用审批、审计、拦截和补充记录       |
| 结束后 | `agent_end` / `session_end`                                 | 记录结果、清理资源、通知外部系统         |

需要继续讨论的是：执行中 Hook 目前主要围绕工具调用，是否还需要覆盖 Runtime handoff、agent updated、checkpoint、approval 等更细粒度节点。

### 3.5 构建 Runtime

`builder.build()` 创建具体 Runtime：

- `PiMonoAgentRuntime`：当前主力 Runtime，基于 `pi-coding-agent` SDK。
- `OpenAIAgentRuntime`：OpenAI Agents SDK 适配层。

两套 Runtime 都必须遵守同一约束：

```text
Runtime 只 yield StreamChunk
广播、持久化、Thread 状态同步都由 AgentExecutor / StreamConsumers 处理
```

P1 后 OpenAI Runtime 已移除直接 `streamEmitter.forward()` 的业务事件路径，`agent:updated` 和工具增量输出也会进入 `StreamChunk`。

## 4. 流式事件链路

### 4.1 Runtime 产出事件

Runtime 对外暴露：

```typescript
runtime.stream(message): AsyncGenerator<StreamChunk, ExecutionResult>
```

常见事件类型：

| 类型                                                                       | 说明                          |
| -------------------------------------------------------------------------- | ----------------------------- |
| `run:start` / `run:done` / `run:error` / `run:interrupted`                 | 执行生命周期                  |
| `turn:start` / `turn:done`                                                 | 推理轮次                      |
| `llm:start` / `llm:done`                                                   | LLM 调用边界                  |
| `text:delta` / `reasoning:delta`                                           | 文本和推理增量                |
| `tool:start` / `tool:progress` / `tool:delta` / `tool:done` / `tool:error` | 工具生命周期                  |
| `agent:updated`                                                            | OpenAI handoff / agent update |

### 4.2 AgentExecutor 统一转发

`consumeAndForward()` 对每个 chunk 执行同一套动作：

```text
chunk
  -> StreamEmitter.forward(chunk)
  -> updateCheckpoint(sessionId, chunk)
  -> fireHooks(chunk, sessionId, ...)
  -> recordMetrics(chunk, sessionId)
  -> onChunk?.(chunk)
  -> yield chunk
```

这意味着：

- SSE 前端看到的是 Runtime yield 出来的同一份 chunk。
- EventBus 消费者也来自同一份 chunk。
- Runtime 不再直接接触 EventBus 或 StreamEmitter。

### 4.3 EventBus 与消费者

事件广播后进入 EventBus：

```text
StreamEmitter.forward()
  -> EventBus
  -> EventWriter(events.jsonl)
  -> HistoryWriter(history.jsonl)
  -> StreamMonitor(metrics)
```

`AgentEventWriter` 只保留为 Extension API 的兼容层：

```text
Extension
  -> AgentEventWriter.dispatchForSession()
  -> EventBus
  -> StreamConsumers
```

它不再直接写 `events.jsonl`，也不再持有 `StreamEmitter`。

## 5. 持久化边界

当前一次 Thread 执行会涉及这些文件：

| 文件                            | 真相源           | 语义                                             |
| ------------------------------- | ---------------- | ------------------------------------------------ |
| `threads/{id}.json`             | `ThreadStore`    | Thread 元数据、agentId、运行状态、workspace 关联 |
| `workspaces/{id}/sessions/...`  | Runtime / SDK    | SDK 会话历史                                     |
| `workspaces/{id}/history.jsonl` | `HistoryWriter`  | 前端友好的聚合消息                               |
| `workspaces/{id}/events.jsonl`  | `EventWriter`    | 细粒度流式事件                                   |
| `workspaces/{id}/context*.json` | Context snapshot | 调试、审计、上下文快照                           |

P1 已经把 agentHome、dataDirectory、workspace、sessionDir 的运行期解析集中到 `AgentContextResolver`，但持久化边界仍需要继续观察：

- `ThreadDefinition` 里仍有一些运行期可推导字段，需要后续判断是否保留。
- `history.jsonl` 仍然承担前端消息投影职责，不应反向成为 SDK session 真相源。
- `events.jsonl` 和 `history.jsonl` 应持续保持“事件事实”和“前端视图”的边界。

## 6. 清理阶段

无论成功、失败还是中止，`AgentExecutor` 最后都会执行清理：

```text
runExtensionEndHooks()
emit agent:done / agent:error
SkillManager.clearSession(sessionId)
streamConsumersManager.clearSession(sessionId)
loader.unloadWorkspaceExtensions(sessionId)
runtime.destroy()
sessionStatus.unregister(sessionId)
```

这里的关键约束是：并发锁必须在 `finally` 中释放，Runtime 必须销毁，workspace 级 Extension 必须卸载。

## 7. P1 后的架构约束

后续改动建议继续守住这些约束：

- ChatRoutes 和 ThreadWaker 不直接拼 Builder，统一走 `ThreadExecutionFactory`。
- 路径、Agent Home、workspace、model override 不分散推导，统一走 `AgentContextResolver`。
- Prompt 附加内容不散落在 Injector / Runtime 中，统一走 `PromptAssemblyService`。
- Runtime 只负责产出 `StreamChunk`，不负责广播。
- `AgentEventWriter` 只作为兼容层存在，新代码不要再依赖它。
- Extension Hook 如果新增时机，需要写进类型、执行链路和文档，避免只停留在注释里。

## 8. 扩展阅读

- [Agent 模块梳理与优化建议](./agent-module-review.md)
- [P1 三个服务接口说明](./agent-p1-services.md)
- [Append Instructions 内容说明](./append-instructions-content.md)
- [Skill 按需加载机制](./core-skills-injection.md)
