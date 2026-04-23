# `src/main/agent` 模块梳理与优化建议

> 最后更新：2026-04-23

本文档聚焦 `src/main/agent` 目录本身，目标不是重复解释“Agent 能做什么”，而是回答 3 个更实际的问题：

1. 这个模块现在的真实职责边界是什么
2. 一次完整执行到底经过了哪些层
3. 里面哪些地方已经开始变得不合理，应该优先怎么收敛

## 1. 模块定位

`src/main/agent` 不是一个“单纯的 LLM SDK 封装层”，而是 Electron 主进程里的 **Agent 执行内核**。它同时承担了下面几类职责：

| 子模块                | 主要职责                                           | 关键文件                                            |
| --------------------- | -------------------------------------------------- | --------------------------------------------------- |
| 执行编排              | 并发锁、Abort、生命周期、Hook、状态同步            | `AgentExecutor.ts`                                  |
| 运行时环境            | workspace、Agent Home、Skill、工具、沙箱上下文注入 | `AgentEnvInjector.ts`, `AgentEnv.ts`                |
| Runtime 适配          | PiMono / OpenAI 两套运行时抽象和 Builder           | `runtime/`                                          |
| 工具系统              | 工具注册、统一执行管线、安全检查                   | `tools/`, `runtime/shared/ToolExecutionPipeline.ts` |
| Skill 系统            | Skill 扫描、缓存、按会话暴露给 `skill_list`        | `skills/SkillManager.ts`                            |
| Agent / Thread 持久化 | Agent 定义、Agent Home、Thread 元数据、恢复        | `agents/`, `threads/`                               |
| Provider              | 模型选择、API Key、thinkingLevel 注入              | `provider/`                                         |
| Extension             | hook、扩展工具、扩展技能、运行时指令               | `extension/`                                        |
| 流式持久化            | EventBus 广播、events/history 写盘                 | `streaming/`                                        |

换句话说，这里已经是一个“小型 agent runtime 平台”，而不是单点模块。

## 2. 真实主链路

### 2.1 启动阶段

应用 READY 时，`src/main/lifecycle/ReadyAgentSystemHook.ts` 会做 4 件关键事情：

1. 初始化 `StreamConsumersManager`
2. 把 builtin tools 注册进 `ToolRegistry`
3. 加载 builtin / user extension
4. 初始化 `ExtensionManager` 并启动 extension watch

因此 `src/main/agent` 并不是“收到消息时才初始化”，而是在应用启动时就把工具、扩展、流式消费者全挂好了。

### 2.2 一次标准 Thread 执行

当前主路径来自 `src/main/routes/ChatRoutes.ts`：

```text
HTTP POST /gateway/chat/threads/:id/messages
  -> ThreadStore.get(threadId)
  -> AgentStore.get(agentId)
  -> agentExecutor.piMono().sessionMode('file')
  -> agentExecutor.stream({ sessionId, message, builder })
```

这里还保留着一个后续要讨论的问题：虽然 P1 已经把 Thread 级 Builder 配置收敛到 `ThreadExecutionFactory`，但入口 Runtime 仍然是 `agentExecutor.piMono()` 写死起手。也就是说，当前系统已经有两套 Runtime 抽象，但路由层还没有真正做成“按 Thread / Agent / Provider 策略选择 Runtime”的模型，这一层仍存在硬编码。

进入 `AgentExecutor.executePipeline()` 后，标准路径大致如下：

```text
ChatRoutes
  -> AgentExecutor.stream()
    -> busy lock / abort controller
    -> injectEnv()
      -> workspace / agentHome / AgentEnv
      -> SkillManager.scanSkills()
      -> appendInstructions 注入
      -> builder.skills(...)
      -> builder.tools(...)
      -> builder.sandboxContext(...)
      -> builder.sessionDir/workspaceRoot/contextDir(...)
    -> Extension start hooks
    -> builder.build()
      -> PiMonoBuilder / OpenAIBuilder
      -> Runtime.initialize()
    -> runtime.stream(message)
    -> consumeAndForward()
      -> StreamEmitter.forward()
      -> EventBus
      -> EventWriter / HistoryWriter
      -> Thread runStatus 同步
      -> metrics / chunk hooks
    -> Extension end hooks
    -> runtime.destroy()
```

这里的 `Extension start hooks` / `Extension end hooks` 只是分组写法，不代表扩展点真的只有两个时机。当前实际还存在工具执行中的 Hook；但 Runtime 级别的 handoff、checkpoint、approval、agent_updated 等节点是否也要成为正式扩展点，仍然是后续需要讨论的设计题。

### 2.3 持久化层分工

当前有 4 类持久化文件同时存在：

| 文件                            | 来源             | 作用                |
| ------------------------------- | ---------------- | ------------------- |
| `threads/{id}.json`             | `ThreadStore`    | Thread 元数据真相源 |
| `workspaces/{id}/sessions/...`  | Runtime / SDK    | LLM 会话历史        |
| `workspaces/{id}/history.jsonl` | `HistoryWriter`  | 前端友好的聚合消息  |
| `workspaces/{id}/events.jsonl`  | `EventWriter`    | 粒度更细的流式事件  |
| `workspaces/{id}/context*.json` | Context snapshot | 调试和审计          |

这里的设计意图是合理的：**Thread 元数据、SDK 会话、前端历史、调试事件** 被拆开保存。但实际代码里，这几层的边界已经开始有一些漂移。

更具体地说，当前已经能看到几个典型漂移点：

- `ThreadStore.create()` 不只是写 `threads/{id}.json`，还会创建 workspace、补 Agent 的 `dataDirectory`、追加 Agent Home 的 `sessions.jsonl`
- `ThreadDefinition` 持久化了 `sessionId`、`agentHomePath`、`agentName` 这类可推导或会陈旧的字段
- `history.jsonl` 不是纯 EventBus 投影，用户消息要靠 `AgentExecutor` 手工调用 `writeUserMessage()` 补进去
- `ThreadRoutes.extractMessagesFromSession()` 名字叫“从 session 提取”，实际读的是 `history.jsonl`
- 事件层同时存在 `EventWriter` 和遗留的 `AgentEventWriter` 两套抽象

这个问题我单独记在了 [Thread / Session / History / Events 持久化边界漂移](../issues/persistence-boundary-drift.md)。

## 3. 当前结构的优点

在说问题前，先把做得对的地方记下来，后续重构应该保留这些优点：

- `AgentExecutor` 把“统一入口”这个角色站住了，外部只需要关心 `submit / stream / submitAndWait`。
- `Runtime` 抽象清楚，`AbstractAgentRuntime` 统一了 `stream/run/runStream` 和错误恢复。
- 工具统一走 `ToolDefinition` + `executeToolPipeline()`，让 PiMono 和 OpenAI 不必各写一套审批/策略逻辑。
- `ThreadStore`、`AgentStore`、`AgentHomeManager` 虽然有耦合，但模型层概念是分开的。
- `EventBus -> StreamConsumers` 让前端历史聚合与 Runtime 解耦，这个方向是对的。

## 4. 目前最不合理、最值得优化的地方

下面按优先级拆成 `P0 / P1 / P2`。`P0` 建议先修，`P1` 建议尽快收敛，`P2` 是结构健康度问题。

### P0-1 `AgentEnvInjector` 已经成了“第二个总调度器”，而且当前就有编译错误

关键文件：

- `src/main/agent/AgentEnvInjector.ts`
- 直接报错点：`211`、`227` 行的 `builderProjectDir`

当前 `injectEnv()` 同时负责：

- 解析 workspace
- 初始化 Agent Home
- 读取 Agent 定义
- 解析 dataDirectory
- 扫 Skill
- 组装 appendInstructions
- 组装技能注入
- 组装工具注入
- 构建沙箱上下文
- 设置 sessionDir / workspaceRoot / contextDir

这已经不是“环境注入器”，而是一个 **运行前总装配器**。同时，`builderProjectDir` 未定义说明这里刚经历过一次“workspace / projectDir 语义重构”，但没有收尾完成。

影响：

- 直接导致 `pnpm typecheck` 失败
- `workspace`、`project dir`、`dataDirectory` 的语义不再清晰
- 任何人修改工具、Skill、目录策略时，都必须先读懂这个大函数

建议：

1. 把 `injectEnv()` 拆成 4 个步骤明确的服务：
   - `resolveRunPaths(sessionId, builder)`
   - `resolveAgentDefinition(agentId)`
   - `buildPromptAssemblyContext(...)`
   - `buildToolExecutionContext(...)`
2. 不再在这个函数里直接探测 Builder 私有字段。
3. 把 “workspaceRoot / projectRoot / dataDirectory” 三个概念先定义清楚，再落代码。

### ✅ P0-2 Thread 恢复路径和正常执行路径不是同一套建模，恢复出来的 Agent 很可能不对（已修复）

**状态**：已修复（commit `6651d2e`）

关键文件：

- 正常路径：`src/main/routes/ChatRoutes.ts:170-181`
- 恢复路径：`src/main/agent/threads/ThreadWaker.ts:165-167`

**修复方案**：

- 在 `ThreadWaker.submitResumeMessage()` 中读取完整的 Thread 和 Agent 数据
- 配置 Builder 与 ChatRoutes 保持一致：
  - `sessionMode('file')` ✅
  - `name(agent.id)` ✅
  - `applyProviderConfig(...)` ✅
  - `instructions(...)` ✅
- 增加错误处理和日志输出
- 增加 TODO 注释，标记需要在 P1 阶段重构

**验证结果**：

- ✅ 编译通过
- ✅ 恢复路径现在会正确持久化会话
- ✅ 恢复路径现在会使用正确的 model 和 instructions
- ⚠️ 建议增加集成测试覆盖（已创建测试文件）

**遗留问题**：

- 代码重复：ChatRoutes 和 ThreadWaker 各有一份配置逻辑（约 15 行）
- 需要在 P1 阶段抽取 `ThreadExecutionFactory` 消除重复代码

---

### P0-2 原始描述（已修复）

正常执行时，`ChatRoutes` 会把这些信息都装进 Builder：

- `sessionMode('file')`
- `name(agent.id)`
- `modelOverride`
- `instructions`

但 `ThreadWaker.submitResumeMessage()` 恢复时只做了：

```ts
const builder = agentExecutor.piMono();
agentExecutor.submit({ sessionId: threadId, message, builder });
```

这意味着恢复路径丢了：

- `agentId`
- `agentName`
- `thread.overrideModel`
- `agent.instructions`
- `sessionMode('file')`

结果是“恢复”出来的执行上下文，和原 Thread 创建时的上下文并不一致。

建议：

1. 新建 `ThreadExecutionFactory` 或 `buildBuilderFromThread(threadId)`。
2. `ChatRoutes` 和 `ThreadWaker` 都走同一条 Builder 组装路径。
3. 把“恢复消息”视为一次正常 run，而不是绕过配置的临时 run。

### ✅ P1-1 Agent / Thread / Env 三层目录语义漂移（已解决）

**状态**：已在 P1 重构中收敛。新增 `AgentContextResolver` 作为运行期上下文解析入口，`AgentStore` / `ThreadStore` 不再各自补运行期 dataDirectory 逻辑，`AgentEnvInjector` 改为从 Resolver 获取 `agentHomePath`、`dataDirectory`、`workspacePath`、`effectiveModel`。

关键文件：

- `src/main/agent/agents/AgentStore.ts:184-219`
- `src/main/agent/threads/ThreadStore.ts:141-178`
- `src/main/agent/AgentEnvInjector.ts:79-104`

同一个 `dataDirectory`，现在至少有 3 处逻辑在维护：

- `AgentStore.create()` 创建 Agent 时自动初始化
- `ThreadStore.ensureAgentDataDirectory()` 创建 Thread 时再补一遍
- `AgentEnvInjector` 每次执行时再推导一次默认路径

`agentHomePath` 也是类似：

- `ThreadStore.create()` 写入 ThreadDefinition
- `AgentEnvInjector` 再次读取 Agent Home
- `AgentStore` 也知道自己的 homeManager

影响：

- 默认值改动时容易漏改
- 测试 mock 更难维护
- 很多“路径修正”类逻辑会开始出现在多个地方

落地结果：

1. `src/main/agent/context/AgentContextResolver.ts` 统一返回 `agentHomePath`、`dataDirectory`、`workspacePath`、`effectiveModel`、`sessionDir`。
2. `AgentStore` 只负责 Agent 定义与 Agent Home 标准文件初始化。
3. `ThreadStore` 只负责 Thread 元数据、workspace 目录和 Agent sessions 索引，不再维护 Agent dataDirectory。

### ✅ P1-2 流式事件链路两套抽象（已解决）

**状态**：已明确唯一主链路为 `Runtime/Extension -> EventBus -> StreamConsumers`。`AgentEventWriter` 被保留为 Extension 兼容适配层，不再直接写 `events.jsonl`，也不再持有 `StreamEmitter`。

关键文件：

- `src/main/agent/streaming/StreamEmitter.ts`
- `src/main/agent/streaming/consumers/EventWriter.ts`
- `src/main/agent/streaming/consumers/HistoryWriter.ts`
- `src/main/agent/AgentEventWriter.ts`
- `src/main/agent/AgentExecutor.ts` 顶部注释

当前真正工作的主链是：

```text
Runtime yield chunk
  -> AgentExecutor.consumeAndForward()
  -> StreamEmitter.forward()
  -> EventBus
  -> EventWriter / HistoryWriter / StreamMonitor
```

但仓库里还保留着另一套 `AgentEventWriter` 抽象，而且 `AgentExecutor` 文件头仍写着“事件写入 → AgentEventWriter.ts”。实际搜索下来，`AgentEventWriter` 只剩 Extension 场景还在碰它。

这说明模块已经发生过架构迁移，但迁移没有完全收尾。

落地结果：

1. `AgentExecutor.consumeAndForward()` 仍是 Runtime chunk 的统一广播出口。
2. Extension 事件通过 `AgentEventWriter.dispatchForSession()` 转成 `stream:message` EventBus 事件。
3. `EventWriter` / `HistoryWriter` 继续作为 EventBus consumers 负责落盘。

### ✅ P1-3 两套 Runtime 事件模型不一致（已解决）

**状态**：OpenAI Runtime 已移除直接 `streamEmitter.forward()/emit()` 的业务事件路径。`agent_updated` 和工具增量输出都先进入 `StreamChunk`，再由 `AgentExecutor` 统一转发。

关键文件：

- `src/main/agent/runtime/openai/OpenAIAgentRuntime.ts:606-609`
- `src/main/agent/runtime/openai/OpenAIAgentRuntime.ts:682-687`
- `src/main/agent/AgentExecutor.ts:276-311`

`AgentExecutor` 的设计目标很明确：**所有 chunk 由 Runtime yield，广播统一在 Executor 做**。

但是 OpenAI Runtime 里仍有几类事件直接走了内部 `streamEmitter`：

- `agent_updated`
- 工具 `onUpdate` 产生的 `tool:delta`

这样会导致两个问题：

1. EventBus 和 SSE 看到的事件不一定一致
2. “Runtime 只产出 chunk，Executor 才负责广播”这个约束被破坏了

PiMono 路径更接近目标架构，OpenAI 路径则还保留了一部分旧做法。

落地结果：

1. OpenAI `agent_updated_stream_event` 现在 yield `agent:updated`。
2. OpenAI 工具执行 `onUpdate` 产生的进度现在 yield `tool:delta`。
3. PiMono / OpenAI 都遵守“Runtime 产出 chunk，Executor 广播”的同一模型。

### ✅ P1-4 Prompt 拼装链过散、PiMono 技能双重注入（已解决）

**状态**：新增 `PromptAssemblyService`，集中处理运行期 prompt 附加块、大小限制和预算估算。PiMono Runtime 保留 `resourceLoader.getSkills()`，但不再额外把技能摘要拼进 appendInstructions。

关键文件：

- `src/main/agent/AgentEnvInjector.ts:115-147`
- `src/main/agent/AgentEnvInjector.ts:313-362`
- `src/main/agent/agents/AgentHomeManager.ts:243-277`
- `src/main/agent/runtime/pimono/PiMonoAgentRuntime.ts:223-253`

目前 Prompt 的来源非常分散：

- `instructions`
- `appendInstructions`
- `runtime_paths`
- `system_agents_md`
- `agent_home`
- `workspace_context`
- `skill_discovery`
- extension inject instructions
- `builder.skills(...)`

其中 PiMono 还同时做了两件事：

1. 通过 `resourceLoader.getSkills()` 传技能
2. 再把技能摘要拼进 `appendInstructions`

这会让“最终 prompt 到底长什么样”非常难推理，也容易造成 token 浪费。

另外，`AGENTS.md` 取消截断、`Agent Home` 最多注入 `10000` 字符、workspace 根目录 markdown 自动加载，也都在放大每轮请求的 prompt 成本。

落地结果：

1. `src/main/agent/prompt/PromptAssemblyService.ts` 统一装配 runtime paths、AGENTS.md、Agent Home、workspace context、Skill discovery、Extension instructions。
2. `AgentEnvInjector` 不再内联 AGENTS.md / workspace markdown 拼装逻辑。
3. AGENTS.md 默认限制 50000 字符，Agent Home 维持 10000 字符，workspace context 维持 6000 字符。
4. PiMono 不再重复注入技能摘要。

### ✅ P1-5 生命周期依赖只写在注释里（已解决）

**状态**：`ReadyGatewayHook.priority` 已调整为 45，执行顺序与注释一致：Gateway(45) -> Agent(50) -> Config(55)。

关键文件：

- `src/main/lifecycle/ReadyGatewayHook.ts:17`
- `src/main/lifecycle/ReadyAgentSystemHook.ts:26`
- `src/main/common/lifecycle.ts:148-150`

`ReadyAgentSystemHook` 注释里写的是“Gateway(45) -> Agent(50) -> Config(55)”，
但实际代码里：

- `ReadyGatewayHook.priority = 50`
- `ReadyAgentSystemHook.priority = 50`
- `LifecycleManager` 会把同优先级 Hook 并行执行

也就是说，**现在代码并没有真正保证 Gateway 先于 Agent System 完成**。

这类问题最危险的点在于：平时可能“碰巧没出事”，但一旦某个 Hook 变慢，就会变成初始化竞态。

后续仍可考虑为 `LifecycleHook` 增加 `dependsOn` 语义，但 P1 阶段的初始化竞态已先通过 priority 收敛。

### ✅ P2-1 主进程里同步文件 IO 太多，流式输出高频时会放大卡顿风险（已收敛）

**状态**：P2 已完成主要高频/批量 IO 路径收敛。`EventWriter` / `HistoryWriter` 不再在 EventBus listener 内同步 `appendFileSync`，而是通过 `AsyncJsonlWriter` 入队后批量异步 flush；会话结束和应用退出前会强制 flush。`ThreadStore.listAsync()`、`AgentStore.rebuildIndexAsync()`、`AgentStore.listAsync()` 已覆盖批量读取路径，事件写盘还提供默认关闭的可选 Worker 通道。

关键文件：

- `src/main/agent/threads/ThreadStore.ts`
- `src/main/agent/agents/AgentStore.ts`
- `src/main/agent/streaming/consumers/EventWriter.ts`
- `src/main/agent/streaming/consumers/HistoryWriter.ts`
- `src/main/agent/streaming/consumers/AsyncJsonlWriter.ts`
- `src/main/routes/ChatRoutes.ts`
- `src/main/routes/ThreadRoutes.ts`
- `src/main/routes/AgentRoutes.ts`
- `src/main/agent/threads/ThreadWaker.ts`

当前大量路径使用了同步 IO：

- `readFileSync`
- `writeFileSync`
- `appendFileSync`
- `mkdirSync`

这些代码都跑在 Electron 主进程里，而主进程同时还承担：

- 窗口生命周期
- IPC
- Gateway
- EventBus

在高频 `text:delta`、工具输出、批量 Thread 列表读取场景下，同步 IO 会放大主线程阻塞风险。

建议：

1. ✅ 事件写盘优先改成“内存队列 + 异步 flush”。
2. ✅ `ThreadStore.list()`/`AgentStore.rebuildIndex()` 这类批量读取迁到 async 版本，并保留兼容入口。
3. ✅ 事件落盘提供可选 Worker 通道：默认普通异步 append，`COOBEE_AGENT_STREAM_WRITE_WORKER=1` 时启用 Worker，失败回退普通异步 append。
4. ✅ 新增 100 events/s 基准流量自动化烟测，覆盖无丢失、顺序完整和耗时阈值。

### ✅ P2-2 还残留一层“已废弃但仍在导出/测试”的 CoreSkills 旧机制（已收敛）

**状态**：`src/main/agent/skills/CoreSkills.ts` 已移除，兼容实现迁入 `src/main/agent/skills/legacy/CoreSkills.ts` 并标记 `@deprecated`；旧 CoreSkills 测试已删除，新代码不要再依赖该机制。

关键文件：

- `src/main/agent/skills/legacy/CoreSkills.ts`
- `src/main/agent/skills/index.ts`

原问题是：架构文档已经明确“强制注入核心 Skills 已废弃”，但代码层面仍保留主路径文件、导出和测试，容易让后来维护的人误以为系统还有一层隐式核心技能机制。

建议：

1. ✅ 已移到 `legacy/`，主路径不再保留 `CoreSkills.ts`。
2. 后续如 UI 需要推荐 Skill，应新增 `RecommendedSkills` 这类明确语义的配置，而不是复用 CoreSkills。

### ✅ P2-3 Skill 缓存没有和热重载/扩展装卸建立明确联动（已解决）

**状态**：`SkillManager.invalidateCache(path?, options?)` 已支持防抖失效、立即失效和缓存统计；`ExtensionLoader.loadAll/load/unload/watch` 路径会在扩展装卸后主动失效 Skill 缓存。

关键文件：

- `src/main/agent/skills/SkillManager.ts:134-143`
- `src/main/agent/skills/SkillManager.ts:179-180`
- `src/main/agent/extension/ExtensionLoader.ts`

原问题是：`SkillManager` 有 30 秒全局缓存，但扩展加载/卸载后缺少主动 `invalidateCache()` 路径。

结果是：

- 新 Skill 目录刚装载时，短时间内可能仍然读到旧缓存
- 热插拔后的行为不够可预期

建议：

1. ✅ Extension load/unload/watch 之后主动失效缓存。
2. 后续如 Skill 规模继续增大，可以再考虑缓存键加入目录 mtime / manifest version。

## 5. 建议的收敛路线

如果后面要真正动这个模块，我建议按下面顺序收：

### 第一阶段：先止血（✅ P0 已完成）

- ✅ 修掉 `AgentEnvInjector` 的 `builderProjectDir` 编译错误
- ✅ 修正 `ThreadWaker`，让恢复路径走和 `ChatRoutes` 相同的 Builder 装配逻辑
- ✅ 修正 Lifecycle priority，消除 READY 阶段竞态
- ✅ 明确当前唯一事件链路，并同步代码注释与文档

### 第二阶段：拆职责（✅ P1 已完成）

- ✅ 新增 `ThreadExecutionFactory`
- ✅ 新增 `AgentContextResolver`
- ✅ 新增 `PromptAssemblyService`
- ✅ 把 `injectEnv()` 收敛成编排函数，不再内联 Prompt 装配细节

目标是把下面这 3 个概念彻底拆开：

- 运行期上下文解析
- Prompt 拼装
- Tool/Sandbox 上下文构建

### 第三阶段：统一 Runtime 行为（✅ P1 已完成）

- ✅ 规定 Runtime 只能 `yield StreamChunk`
- ✅ 广播、持久化、Thread 状态同步都在 Executor / consumers 做
- ✅ 对齐 PiMono / OpenAI 的工具增量输出和 handoff 事件语义

### 第四阶段：性能与维护性（✅ P2 已完成）

- ✅ 流式事件持久化改异步队列
- ✅ 可选 Worker 写盘路径
- ✅ Store 批量读取异步化
- ✅ 100 events/s 自动化基准烟测
- ✅ Skill cache 与扩展热插拔联动
- ✅ 清理 `CoreSkills` 主路径残留，迁入 legacy 兼容层
- ✅ 把 README / 架构文档 / 测试前提统一到当前实现
- 后续可继续补桌面端真实 Agent 高频输出人工压测

## 6. 一句话结论

`src/main/agent` 现在最核心的问题不是“功能不够”，而是 **能力增长快于职责收敛**：

- 主链路已经能跑
- 分层大方向也是对的
- 但 `AgentExecutor`、`AgentEnvInjector`、`ThreadStore`、Runtime、streaming 之间已经出现了多处语义重叠和旧实现残留

如果只做功能叠加，这个模块会越来越难改；如果先按上面的 `P0 -> P1` 收一轮，后面无论是加多 Agent、审批流、自动化还是更多 Provider，成本都会低很多。
