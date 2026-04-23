# Agent 模块架构说明

> 最后更新：2026-04-23

`src/main/agent` 是 Electron 主进程里的 Agent 执行内核。它不是单纯的 SDK wrapper，而是负责把 Thread、Agent 定义、Runtime、工具、Skill、Extension、沙箱和事件持久化串成一条可执行链路。

## 目录结构

```text
src/main/agent/
├── AgentExecutor.ts              # 执行调度：并发锁、Abort、Hook、事件转发、清理
├── AgentEnv.ts                   # 运行期 AgentEnv 类型和 runtime paths 格式化
├── AgentEnvInjector.ts           # 环境注入：workspace、Skill、工具、沙箱、prompt blocks
├── AgentEventWriter.ts           # 已废弃兼容层：Extension 事件转发到 EventBus
├── agents/                       # Agent 定义、Agent Home、导入导出
├── context/                      # AgentContextResolver：统一运行期路径和上下文解析
├── execution/                    # ThreadExecutionFactory：统一 Thread -> Builder 配置
├── extension/                    # Extension 加载、注册、Hook 执行和隔离
├── prompt/                       # PromptAssemblyService：appendInstructions 拼装
├── provider/                     # Provider、模型选择、API Key、fallback、成本统计
├── runtime/                      # Runtime 抽象、PiMono/OpenAI 适配、session/compression/tool services
├── sandbox/                      # 路径守卫、命令策略、工具策略、Docker 上下文
├── skills/                       # Skill 扫描、缓存、按需发现
├── streaming/                    # StreamEmitter、EventWriter、HistoryWriter、StreamMonitor
├── threads/                      # Thread 元数据、恢复唤醒、workspace 目录结构
└── tools/                        # SDK 无关 ToolDefinition、注册表、内置工具
```

## 核心执行链路

```text
ChatRoutes / ThreadWaker
  -> ThreadExecutionFactory.createBuilder()
  -> AgentExecutor.stream() / submit()
  -> AgentEnvInjector.injectEnv()
  -> Extension start hooks
  -> builder.build()
  -> runtime.stream(message)
  -> AgentExecutor.consumeAndForward()
  -> StreamEmitter.forward()
  -> EventBus
  -> StreamConsumers(EventWriter / HistoryWriter / StreamMonitor)
  -> Extension end hooks
  -> runtime.destroy()
```

P1 后的关键约束：

- Thread 执行 Builder 统一由 `ThreadExecutionFactory` 创建，避免 ChatRoutes 和 ThreadWaker 配置漂移。
- Agent Home、dataDirectory、workspace、sessionDir、effectiveModel 统一由 `AgentContextResolver` 解析。
- runtime paths、AGENTS.md、Agent Home、workspace context、Skill discovery 和 Extension instructions 统一由 `PromptAssemblyService` 拼装。
- Runtime 只产出 `StreamChunk`，事件广播和落盘统一由 `AgentExecutor -> StreamEmitter -> EventBus -> StreamConsumers` 完成。

## Runtime

| Runtime              | SDK               | 状态         |
| -------------------- | ----------------- | ------------ |
| `PiMonoAgentRuntime` | `pi-coding-agent` | 主力 Runtime |
| `OpenAIAgentRuntime` | `@openai/agents`  | 支持 Runtime |

两套 Runtime 都实现 `AgentRuntime` 接口，并以 `AsyncGenerator<StreamChunk>` 形式输出事件。OpenAI Runtime 在 P1 后也不再直接调用 `StreamEmitter`，`agent:updated` 和工具增量统一走 yield。

## 工具系统

工具使用 SDK 无关的 `ToolDefinition`：

```typescript
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ZodSchema;
  execute: (
    params: Record<string, unknown>,
    signal?: AbortSignal,
    context?: ToolExecutionContext
  ) => AsyncGenerator<ToolStreamUpdate, ToolResult, unknown>;
}
```

工具执行统一经过 sandbox 和 pipeline，Runtime 只负责把工具定义转换为对应 SDK 的工具格式。

常见内置工具：

| 类别   | 工具                                                                              |
| ------ | --------------------------------------------------------------------------------- |
| 文件   | `read`, `write`, `edit`, `glob`, `search`                                         |
| 执行   | `exec`, `process`                                                                 |
| 记忆   | `memory`                                                                          |
| 可观测 | `session_status`, `session_history`, `context_inspect`, `task-plan`, `todo-write` |
| 发现   | `skill_list`                                                                      |

## Skill 与 Prompt

Skill 通过按需发现机制暴露给 Agent：

1. Runtime 注入 Skill discovery 说明。
2. Agent 调用 `skill_list` 查看可用 Skill。
3. Agent 选择需要的 Skill 后，用 `read` 读取对应 `SKILL.md`。
4. Agent 按 Skill 指令执行任务。

Prompt 附加块不再散落在 Runtime 和 Injector 中，而是由 `PromptAssemblyService` 统一装配，并带默认字符预算。

## Extension

Extension Hook 分三类：

| 阶段   | Hook                                                      |
| ------ | --------------------------------------------------------- |
| 启动前 | `message_received`, `session_start`, `before_agent_start` |
| 执行中 | `before_tool_call`, `after_tool_call`                     |
| 结束后 | `agent_end`, `session_end`                                |

如果后续需要把 agent handoff、checkpoint、approval 等节点也做成扩展点，需要同步更新 Hook 类型、执行位置和架构文档。

## 事件与持久化

主事件链路：

```text
Runtime yield chunk
  -> AgentExecutor.consumeAndForward()
  -> StreamEmitter.forward()
  -> EventBus
  -> EventWriter(events.jsonl)
  -> HistoryWriter(history.jsonl)
  -> StreamMonitor
```

持久化分工：

| 文件                            | 语义                |
| ------------------------------- | ------------------- |
| `threads/{id}.json`             | Thread 元数据真相源 |
| `workspaces/{id}/sessions/...`  | SDK 会话历史        |
| `workspaces/{id}/history.jsonl` | 前端消息投影        |
| `workspaces/{id}/events.jsonl`  | 细粒度事件日志      |
| `workspaces/{id}/context*.json` | 调试和审计快照      |

## 参考文档

- [Agent 执行流程](../../../docs/architecture/agent-execution-flow.md)
- [Agent 模块梳理与优化建议](../../../docs/architecture/agent-module-review.md)
- [P1 三个服务接口说明](../../../docs/architecture/agent-p1-services.md)
