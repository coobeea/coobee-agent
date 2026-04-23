# Agent P1 服务接口说明

> 最后更新：2026-04-23

P1 重构新增并落地了三个服务，用来收敛 `src/main/agent` 中最容易漂移的三类逻辑：运行期上下文、Thread Builder 配置、Prompt 附加块拼装。

## 1. AgentContextResolver

位置：`src/main/agent/context/AgentContextResolver.ts`

职责：

- 根据 `agentId`、`sessionId`、workspace 信息解析运行期上下文。
- 统一返回 Agent Home、dataDirectory、workspace、sessionDir、effectiveModel。
- 处理默认值、路径安全校验和缓存，避免 AgentStore、ThreadStore、AgentEnvInjector 各自推导路径。

核心接口：

```typescript
const context = await AgentContextResolver.getInstance().resolve({
  agentId,
  sessionId,
  workspacePath,
  modelOverride
});
```

返回值重点字段：

| 字段             | 说明                                        |
| ---------------- | ------------------------------------------- |
| `agent`          | Agent 定义                                  |
| `agentHomePath`  | Agent Home 目录                             |
| `dataDirectory`  | Agent 数据目录                              |
| `workspacePath`  | 当前执行 workspace                          |
| `sessionDir`     | Runtime file session 目录                   |
| `effectiveModel` | Thread override 和 Agent 默认值合并后的模型 |

使用约束：

- 新代码不要在 `AgentStore`、`ThreadStore`、`AgentEnvInjector` 中重复推导这些路径。
- 修改默认目录策略时优先改 Resolver 和对应测试。
- Resolver 返回的是运行期上下文，不应替代 `ThreadStore` 的 Thread 元数据持久化职责。

## 2. ThreadExecutionFactory

位置：`src/main/agent/execution/ThreadExecutionFactory.ts`

职责：

- 把 Thread + Agent 定义转换为 Runtime Builder。
- 统一 ChatRoutes 正常执行和 ThreadWaker 恢复执行的配置路径。
- 保证 `sessionMode`、`name`、`instructions`、provider config、workspacePath 一致。

核心接口：

```typescript
const builder = await ThreadExecutionFactory.getInstance().createBuilder({
  threadId,
  sessionMode: 'file'
});
```

配置内容：

| 配置                  | 来源                                 |
| --------------------- | ------------------------------------ |
| `sessionMode`         | 调用方参数，默认主链路使用 `file`    |
| `name`                | Agent id                             |
| `instructions`        | Agent instructions，空字符串会被忽略 |
| `applyProviderConfig` | Resolver 合并后的 effectiveModel     |
| `workspacePath`       | Thread metadata / Resolver 上下文    |

使用约束：

- ChatRoutes 和 ThreadWaker 不直接调用 `agentExecutor.piMono().sessionMode(...).name(...).instructions(...)` 拼 Builder。
- 如果后续支持多 Runtime，Factory 应负责根据 Thread/Agent 配置选择 Builder，而不是在路由层写死。
- 这也是目前记录的后续问题：主路径仍默认 PiMono，runtime 选择策略需要单独设计。

## 3. PromptAssemblyService

位置：`src/main/agent/prompt/PromptAssemblyService.ts`

职责：

- 统一读取和排序 appendInstructions 来源。
- 给 AGENTS.md、Agent Home、workspace context 增加默认字符预算。
- 让最终 prompt 附加块可追踪、可测试、可逐步优化 token 成本。

核心接口：

```typescript
const blocks = promptAssembly.assemble({
  runtimePathsBlock,
  agentHome,
  agentId,
  agentHomeManager,
  workspace,
  skillDiscoveryHint,
  extensionInstructions
});

builder.appendInstructions(...promptAssembly.toInstructions(blocks));
```

固定顺序：

1. `runtime_paths`
2. `agent_rules`
3. `agent_home`
4. `workspace_context`
5. `skill_discovery`
6. `extension_instruction_N`

默认限制：

| 内容                   | 默认限制   |
| ---------------------- | ---------- |
| Agent Home             | 10000 字符 |
| Agent rules            | 50000 字符 |
| Workspace context 总量 | 6000 字符  |
| Workspace 单文件       | 3000 字符  |

使用约束：

- `AgentEnvInjector` 只准备上下文，不再内联读取 AGENTS.md 或 workspace markdown 的拼装逻辑。
- 全局 `.home/agents.md` 不再注入 prompt；Agent 级规则只读取当前 Agent Home 下的 `AGENTS.md`。
- PiMono Runtime 保留 `resourceLoader.getSkills()` 给 SDK 使用，但不再额外把技能摘要拼进 appendInstructions。
- Extension 如需注入运行期指令，应通过 `extensionInstructions` 进入统一排序，而不是直接改 Runtime prompt。

## 4. 事件模型补充

P1 同时收敛了事件模型：

- Runtime 只 yield `StreamChunk`。
- `AgentExecutor.consumeAndForward()` 是唯一广播出口。
- `AgentEventWriter` 仅作为 Extension API 兼容层，把 chunk 包装为 EventBus message。
- OpenAI Runtime 的 `agent:updated` 和工具 `tool:delta` 也进入 yield 链路。

后续如果新增 Runtime 或事件类型，需要先确认是否仍满足：

```text
Runtime -> StreamChunk -> AgentExecutor -> EventBus -> StreamConsumers
```

不要在 Runtime 内部绕过 Executor 直接写事件或直接广播。
