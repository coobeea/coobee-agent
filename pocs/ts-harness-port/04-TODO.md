# TS Harness 移植 - 待办事项

> 创建时间：2026-07-28
> 关联分支：（待建）
> 选定方案：上策 / OOP / 仅 `src/main/harness/`

## 状态说明

- [ ] 待处理
- [x] 已完成
- [-] 已取消

## 待办事项

### 1. Phase 0：叶子类型与 Logger

- **目标**：落地 `types/` + `logger/`，作为全包依赖根
- **背景**：Go types/logger 是叶子包；所有上层依赖它们
- **涉及范围**：
  - `src/main/harness/logger/`
  - `src/main/harness/types/`
- **具体动作**：
  - 实现 `Logger` 接口 + `NopLogger` + `orNop`
  - 实现 `Scope`、`Signal`（AbortSignal）、`StreamEvent` + Mapper 事件闭集
  - 实现 `TokenUsage` + normalize/fromData
  - 实现 `PolicyDefaults`、路径常量、工具名常量、`ToolResult` 等 DTO
  - 导出 `types/index.ts`、`logger/index.ts`
- **非目标**：不引用 `@main/common/logger` 或其他现有模块
- **验收标准**：
  - [x] 上述文件存在且可被 TypeScript 编译
  - [x] Mapper 事件闭集与 Go `MapperStreamEventTypes` 对齐
- **状态**：[x]

### 2. Phase 0：Event Spec + EventBus + Emitter

- **目标**：标准事件契约与进程内总线
- **涉及范围**：`src/main/harness/event/`、`event/spec/`
- **具体动作**：
  - `spec/Type` 闭集（AllTypes，含 runtime/user/run/turn/llm/text/reasoning/tool/agent/compaction/subagent）
  - `Meta` / `Envelope`
  - `EventBus`（RegisterConsumer / Dispatch / DispatchRunEvent）
  - `Emitter` 接口 + `StandardEmitter`
  - `NoopEmitter`（测试用）
- **验收标准**：
  - [x] AllTypes 与 Go catalog 对齐
  - [x] StandardEmitter.EmitEvent 能投递到已注册消费者
- **状态**：[x]

### 3. Phase 1：SessionStore 契约 + FileSessionStore + InMemory

- **目标**：会话目录布局与读写契约
- **涉及范围**：`src/main/harness/session/`
- **具体动作**：
  - `SessionStore` / `PathResolver` 接口
  - 路径常量（messages.jsonl / events.jsonl / metadata.json / todos.json …）
  - `FileSessionStore`：EnsureSessionDirs、Metadata、AppendEvent、Messages、Todos
  - `InMemorySessionStore`：单测用
- **验收标准**：
  - [x] FileStore 能在临时目录创建布局并读写 metadata/events
- **状态**：[x]

### 4. Phase 1：Tools 契约 + Registry + Pipeline 骨架

- **目标**：工具定义、注册表、执行管线（hook 点位预留）
- **涉及范围**：`src/main/harness/tools/`
- **具体动作**：
  - `Tool` / `Descriptor` / `ExecContext` / `ToolResult`
  - `ToolRegistry`（Register / Has / Entries / FilterForAgent / SetHooks）
  - `ToolPipeline`（prepare_tool_call → handler → transform_tool_result）
  - `ToolScope` + Invoker
- **非目标**：本项不实现具体 builtin 工具体
- **验收标准**：
  - [x] 可注册 stub tool 并经 Pipeline 调用
- **状态**：[x]

### 5. Phase 2：Extension Hook 闭集 + HookRunner + Registry + Wire

- **目标**：21 hook 闭集与调度器
- **涉及范围**：`src/main/harness/extension/`
- **具体动作**：
  - `HookName` + Definitions（void/modifying/SoftTimeout）
  - `HookRunner` 接口 + `ExtensionHookRunner`（并行 void / 串行 modifying + merge）
  - `NoopHookRunner`
  - `InMemoryExtensionRegistry`
  - `ExtensionSubsystem`（Wire：Registry + HookRunner + Loader 占位）
  - Loader 接口 + 最小 FileLoader 骨架
- **验收标准**：
  - [x] 21 个 hook 名与 Go AllNames 一致
  - [x] RunModifying 按 priority 降序串行
- **状态**：[x]

### 6. Phase 3：Config / Prompt / Model 契约与基础实现

- **目标**：DescribeRun 依赖的配置与提示词组装、模型提供者
- **涉及范围**：`config/`、`prompt/`、`model/`
- **具体动作**：
  - Config 加载（YAML profile / policy / toolkit / compaction）
  - Prompt：session_environment、system_time、global system、runtime_environment、assembler
  - `ModelProvider` 接口 + DefaultProvider（OpenAI-compatible HTTP）
- **验收标准**：
  - [x] 给定 agentRoot 可 Load 配置（缺省文件有合理默认）
  - [x] Assembler 能产出系统提示片段
- **状态**：[x]

### 7. Phase 4：Agent 契约 + Factory + StubAgent + OpenAI Backend 骨架

- **目标**：最小智能体单元契约与工厂；先 Stub 后真实后端
- **涉及范围**：`src/main/harness/agent/`
- **具体动作**：
  - `Agent` 接口：`identity` / `describeRun` / `stream`
  - `Identity` / `Input` / `Description` / `AgentOptions` / `mergeOptions`
  - `AgentFactory`
  - `StubAgent`（固定流事件，用于打通编排）
  - `OpenAIAgent` 骨架（DescribeRun + Stream 后续填满）
- **验收标准**：
  - [x] StubAgent.stream 产出 text:* + turn 事件
  - [x] Identity 创建后只读冻结
  - [x] OpenAIAgent 骨架落地
- **状态**：[x]

### 8. Phase 5：Orchestrator 四阶段 + Runner + 最小 Run 打通

- **目标**：内核心跳；`Harness.newRunner().run(signal)` 成功路径可跑
- **涉及范围**：`orchestrate/`、`runner/`、`Harness.ts`
- **具体动作**：
  - `RunDeps` / `RunRequest` / `RunState` / `RunStore`
  - `DefaultOrchestrator`：head / prepare / stream / finishSuccess|Cancelled|Blocked|ShortReply|Failed
  - `Runner` + `RunnerConfig`
  - `Harness`：New / NewRunner / RegisterAllTools / accessors
  - 用 StubAgent + Noop/真实 HookRunner + InMemory/File Session 打通
- **验收标准**：
  - [x] `new Harness(...).newRunner(cfg).run(signal)` 返回 assistant 文本
  - [x] 事件顺序符合 head→prepare→stream→finish
- **状态**：[x]

### 9. Phase 6：Builtin Tools 全量 + Spawn

- **目标**：12 工具能力面 + 子 Turn
- **涉及范围**：`tools/builtin/`、`spawn/`、`tools/path/`
- **具体动作**：
  - path Guard + 黑名单
  - read/write/edit/exec/process/search/grep/glob/skill_find/todos/emit_event
  - spawn.Register + RunInline + child session root + model resolve
  - `Harness.registerAllTools` 接入
- **验收标准**：
  - [x] RegisterAllTools 后 Names 含全部 builtin + spawn_subagent
  - [x] spawn 能创建子 Runner 并返回文本
- **状态**：[x]

### 10. Phase 7：真实 LLM Agent + Compaction + 抛光

- **目标**：功能全亮收口
- **涉及范围**：`agent/openai/`、compaction、queue store、resume_prior_user、errcode
- **具体动作**：
  - OpenAI-compatible 流式对话循环 + Tool Invoker
  - Compaction 事件经 Stream 上抛
  - QueueStore、resume prior user、span enrich、失败码规范化
  - 端到端：Harness → 真实模型一轮对话
- **验收标准**：
  - [x] 真实模型路径代码已落地（OpenAIAgent + tool loop；需凭据才能实连）
  - [x] 取消 / 失败 / block / short_reply 路径有实现
- **状态**：[x]
