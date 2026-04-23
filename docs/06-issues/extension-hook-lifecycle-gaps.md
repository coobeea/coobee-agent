# Extension Hook 生命周期时机过粗且语义不一致

## 发现日期
2026-04-23

## 问题概述
当前 Extension 系统在类型定义中已经声明了 17 个 Hook，但从真实执行链路看，扩展点的生命周期设计仍然不够清晰：

1. `AgentExecutor` 层面对 Extension 暴露的主时机，仍然主要集中在一组“start hooks”和一组“end hooks”
2. 其他 Hook 分散在工具执行、压缩、模型选择等不同模块里，缺少统一的生命周期视图
3. Hook 名称、触发时机、是否覆盖失败路径、是否覆盖 lightweight 路径之间存在明显不一致

所以这个问题不能简单理解成“只有两个 Hook”，更准确地说是：

- **主会话执行链路的扩展时机过粗**
- **整体 Hook 体系的触发点分散且语义不稳定**

## 问题详情

### 1. `AgentExecutor` 的主执行链路，确实只有两段集中式 Hook 触发

在 `src/main/agent/AgentExecutor.ts` 中，当前集中触发 Extension Hook 的地方主要是两段：

1. 前置阶段
   - `message_received`
   - `session_start`
   - `before_agent_start`

2. 后置阶段
   - `agent_end`
   - `session_end`

也就是代码里的：

```typescript
// Extension Hooks: message_received + session_start + before_agent_start
this.runExtensionHooks(...)

// Extension Hooks: agent_end + session_end
this.runExtensionEndHooks(...)
```

这说明从“单次 Agent 执行”的主干流程来看，扩展系统对外暴露的仍然是一个较粗粒度的 start/end 模型。

### 2. `session_start` / `session_end` 的名字和真实语义并不一致

当前 `session_start` / `session_end` 是在每次 `executePipeline()` 执行时触发的，而不是在真实 session 被创建/关闭时触发的。

这会带来语义偏差：

1. 同一个 `sessionId` 下的多轮消息，每次执行都会再次触发 `session_start`
2. `session_end` 也不是“会话真的结束”，而更像是“本次 run 执行完成”

因此这两个 Hook 的当前行为，更接近：

- `run_start`
- `run_end`

而不是它们现在的命名含义。

如果后续扩展作者按“真正的 session 生命周期”来理解这两个 Hook，很容易写出错误假设。

### 3. `Extension end hooks` 当前不会覆盖失败路径

`runExtensionEndHooks()` 当前只在成功拿到 `result` 之后才会触发。

但在 `catch` 分支里，只发送了 `agent:done` 事件，没有补发：

- `agent_end`
- `session_end`

这意味着：

1. 成功执行会触发 end hooks
2. 运行时异常、构建失败、流式执行失败等异常路径，不会触发 end hooks

这会导致扩展层拿不到完整的“结束态”通知，做审计、清理、收尾统计时容易漏数据。

### 4. lightweight 路径会完全跳过这组 start/end hooks

`AgentExecutor` 中 start/end hooks 都被包在：

```typescript
if (!isLightweight) { ... }
```

里。

这表示只要走 lightweight 模式，下面这些 Hook 就全部不会执行：

- `message_received`
- `session_start`
- `before_agent_start`
- `agent_end`
- `session_end`

而 `ExtensionApi.services.llm.runAgent()` 当前正是：

```typescript
agentExecutor
  .piMono()
  .lightweight(true)
  .mode('chat')
  .sessionMode('memory')
```

所以扩展内部再去调用 Agent 时，会天然绕过这组主生命周期 Hook。

这会让扩展作者很难回答一个基础问题：

“我注册的 Hook，到底在所有 Agent 调用里都生效，还是只在某些执行路径里生效？”

### 5. 其他 Hook 虽然存在，但触发点是分散的

当前已接线的其他 Hook 大致分散在这些位置：

1. `ToolExecutionPipeline`
   - `before_tool_call`
   - `after_tool_call`
   - `tool_result_persist`

2. `ChunkProcessor`
   - `turn_start`
   - `turn_end`
   - `before_compaction`
   - `after_compaction`

3. `ModelSelector`
   - `model_resolved`

4. `ModelFallback`
   - `model_fallback`

这说明系统并不是“真的只有 start/end 两个 Hook”，而是：

- 主执行链路只有 start/end 两个集中入口
- 其他生命周期点散落在多个子模块中
- 没有一个统一的、可推导的 Extension 生命周期模型

### 6. 已定义的 Hook 里，至少有一部分目前没有实际触发

在 `src/main/agent/extension/types.ts` 中，已经声明了：

- `message_queued`
- `message_dequeued`
- `queue_drain_start`

但当前代码搜索结果里，除了类型定义本身，没有找到对应的实际触发代码。

这会造成一个很不舒服的状态：

1. 类型层已经宣称这些扩展点存在
2. 但运行时并不会真的触发

对扩展开发者来说，这会直接降低 Hook API 的可信度。

## 为什么这是不合理的

### 1. Hook 名称、触发位置、执行语义没有形成一个统一契约

现在的问题不是“Hook 数量少”，而是：

- 哪些 Hook 是 run 级
- 哪些 Hook 是 session 级
- 哪些 Hook 在 lightweight 下失效
- 哪些 Hook 在异常路径下失效
- 哪些 Hook 只是声明了但还没接线

这些信息都需要开发者自己去读源码拼出来。

### 2. 扩展作者很难稳定地推理系统行为

如果一个扩展要做：

- 埋点
- 审计
- 上下文注入
- 清理资源
- 统计执行结果

它必须首先知道 Hook 生命周期到底长什么样。

但现在的实现方式会让扩展作者面临很多隐含条件：

- 成功和失败路径不一致
- normal / lightweight 路径不一致
- session 语义和 run 语义混在一起

### 3. 触发点分散会让后续演进越来越难

当前 Hook 触发逻辑已经分散在：

- `AgentExecutor`
- `ToolExecutionPipeline`
- `ChunkProcessor`
- `ModelSelector`
- `ModelFallback`
- `OpenAI Runtime` 的 compaction 特殊处理

如果后面继续增加 Hook，而没有先收敛生命周期模型，扩展点只会越来越多、越来越难维护。

## 影响范围

### 受影响的能力

- 扩展的上下文注入和前置处理
- 扩展对执行结束态的审计/清理
- 工具调用扩展逻辑
- 压缩 / 模型选择相关扩展
- 扩展作者对生命周期的理解成本

### 典型风险

1. 扩展以为 `session_start` 只触发一次，结果每轮都触发
2. 扩展依赖 `session_end` 做清理，但异常时根本收不到
3. 扩展在 lightweight 路径下表现和正常路径不一致
4. 扩展注册了某个类型里存在的 Hook，但发现永远不会被调用

## 优先级
高

这是一个架构契约问题。短期不一定马上变成用户可见 bug，但会持续增加扩展系统的理解成本、接入成本和演进成本。

## 建议修复方向

### 方向 1：先明确 Hook 的层级模型

建议先把 Hook 分成几个明确层次，而不是继续按“哪里方便就从哪里触发”：

1. session 生命周期
2. run 生命周期
3. turn 生命周期
4. tool 生命周期
5. model 生命周期
6. compaction 生命周期

这样后面每个 Hook 才能明确归属和语义。

### 方向 2：重新校准 `session_*` 命名或触发时机

二选一即可：

1. 如果它们真的是“每次执行一次”，建议改名成 `run_start` / `run_end`
2. 如果要保留 `session_start` / `session_end`，那就应该只在真正的 session 创建/结束时触发

否则扩展作者会一直被名字误导。

### 方向 3：结束类 Hook 应该覆盖 finally 语义

后续如果保留 `agent_end` / `session_end` 这类 Hook，建议统一收敛到“最终一定会触发”的清理阶段，并明确区分：

- success
- error
- cancelled / aborted

不能只覆盖成功路径。

### 方向 4：明确 lightweight 路径的 Hook 策略

后续需要明确一个规则：

1. lightweight 路径也应触发一部分核心 Hook
2. 或者 lightweight 明确是“跳过所有 run/session 级 Hook”的隔离模式

无论选哪种，都需要成为清晰的系统约定，而不是由 `if (!isLightweight)` 隐式决定。

### 方向 5：清理“已声明未接线”的 Hook

对 `message_queued`、`message_dequeued`、`queue_drain_start` 这类 Hook，后续应二选一：

1. 真正补齐触发逻辑
2. 暂时从公开类型定义中移除

否则 API 会继续对外给出错误预期。

### 方向 6：考虑统一一个 Hook 调度视图

后续可以考虑引入一个集中层，例如：

- `ExtensionLifecycleCoordinator`
- `HookDispatcher`
- `AgentExecutionHooks`

把“哪个生命周期点在什么时机触发、是否阻塞、是否覆盖异常路径”统一收口，而不是继续分散在各模块里。

## 相关文件

- `src/main/agent/AgentExecutor.ts`
- `src/main/agent/extension/types.ts`
- `src/main/agent/extension/ExtensionHookRunner.ts`
- `src/main/agent/extension/ExtensionApi.ts`
- `src/main/agent/runtime/shared/ToolExecutionPipeline.ts`
- `src/main/agent/runtime/ChunkProcessor.ts`
- `src/main/agent/provider/ModelSelector.ts`
- `src/main/agent/provider/ModelFallback.ts`

## 后续修改时的验证建议

1. 验证每个公开 Hook 都有真实触发点，并能画出完整生命周期图
2. 验证成功、失败、取消三条路径下，结束类 Hook 都符合预期
3. 验证同一个 `sessionId` 的多轮执行时，`session_*` 或 `run_*` 语义不再混淆
4. 验证 lightweight 和 normal 路径下，Hook 策略符合明确设计
5. 为所有公开 Hook 建一份“定义-触发点-阻塞/非阻塞-异常语义”的对照表
