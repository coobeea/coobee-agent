# Agent 扩展模型收敛 - 待办事项

> 创建时间：2026-04-24
> 关联主题：agent-extension-event-model

## 状态说明

- [ ] 待处理
- [x] 已完成
- [-] 已取消 / 延后

## 待办事项

### 1. 整理 runtime 扩展 API 的分类和命名

- **目标**：把 runtime 扩展 API 明确拆成 `Event` 和 `Interceptor` 两类，并将误导性的旧命名收敛到能直接表达真实语义的名字。
- **背景**：
  - 当前 `before_* / after_* / session_* / agent_end` 混合了通知事件、可修改拦截点和 run 生命周期语义
  - 阅读代码时容易误判“这个点能不能拦截”“它表达的是 session 还是一次 run”
  - 如果不先收口 runtime 命名，后面的具体业务扩展场景也会继续混乱
- **涉及范围**：
  - `src/main/extension/types.ts`
  - `src/main/extension/ExtensionApi.ts`
  - `src/main/extension/ExtensionHookRunner.ts`
  - `src/main/agent/AgentExecutor.ts`
  - `src/main/agent/runtime/shared/ToolExecutionPipeline.ts`
  - 相关调用点、测试和文档
- **具体动作**：
  - 在 `types.ts` 中显式区分 `Event` 和 `Interceptor`
  - 将 `before_agent_start` 改为 `prepare_run_input`
  - 将 `before_tool_call` 改为 `prepare_tool_call`
  - 将 `tool_result_persist` 改为 `transform_tool_result`
  - 将 `session_start` 改为 `run_started`
  - 将 `agent_end` 改为 `run_completed`
  - 删除 `session_end`
  - 将 `turn_start / turn_end` 改为 `turn_started / turn_completed`
  - 将 `after_tool_call` 改为 `tool_call_completed`
  - 将 `before_compaction / after_compaction` 改为 `compaction_started / compaction_completed`
  - 将 runtime/provider 内部事件移出默认公开扩展面
  - 同步更新触发点、类型、测试和文档
- **非目标**：
  - 本项不绑定具体业务扩展场景
  - 本项不设计具体扩展包的执行链路
- **验收标准**：
  - [ ] `types.ts` 里能明显看出哪些是 `Event`，哪些是 `Interceptor`
  - [ ] 上述 rename 已在调用点和类型定义中完成同步
  - [ ] `session_end` 已移除，runtime/provider 内部事件不再出现在默认公开扩展类型中
  - [ ] 文档与代码中的命名一致
- **状态**：[ ]

### 2. 建立 `resources/extensions/` 内置扩展根目录

- **目标**：在 `resources/` 下建立一个稳定的内置扩展根目录，让“内置扩展资源”有明确归属，而不是继续散落在技能目录或运行时代码之外。
- **背景**：
  - 当前 `resources/` 下已有 `agents` 和 `skills`
  - 但缺少一个专门承载“产品内置扩展资源”的目录
  - 如果没有这个根目录，后续无论挂什么扩展场景，都只能被误塞进 skill 或 runtime extension
- **涉及范围**：
  - `resources/extensions/`
  - `resources/extensions/README.md`
  - `pocs/agent-extension-event-model/*.md`
- **具体动作**：
  - 新增 `resources/extensions/` 目录
  - 在根目录 README 中明确区分：
    - `src/main/extension/` 是 runtime 扩展机制
    - `resources/extensions/` 是内置扩展目录
    - `resources/skills/` 仍然是技能资源，不承担扩展注册语义
  - 在 POC 文档中同步写清该目录的定位
- **非目标**：
  - 本项不实现任何 loader / registry 代码
  - 本项不开放任意脚本型扩展入口
- **验收标准**：
  - [x] 存在 `resources/extensions/`
  - [x] `README.md` 中清楚说明该目录与 `src/main/extension/`、`resources/skills/` 的边界
  - [x] POC 文档中已将 `resources/extensions/` 写入整体扩展模型
- **状态**：[x]

### 3. 将首个具体业务扩展场景延后到下一轮讨论

- **目标**：在本轮只完成扩展机制底座和目录规划，不提前把某个具体业务扩展场景写死进 POC。
- **背景**：
  - 具体业务场景本身还在讨论中
  - 如果场景没有稳定，就不应该先反推扩展目录结构和执行链路
  - 这轮更应该先把机制边界收干净
- **涉及范围**：
  - `pocs/agent-extension-event-model/01-需求分析.md`
  - `pocs/agent-extension-event-model/02-方案设计.md`
  - `pocs/agent-extension-event-model/03-反思优化.md`
  - `pocs/agent-extension-event-model/04-TODO.md`
  - `resources/extensions/README.md`
- **具体动作**：
  - 从本轮 POC 中移除尚未定版的具体业务场景设计
  - 保留 `resources/extensions/` 作为通用目录
  - 在文档里明确：具体场景后续单独讨论、单独推进
- **非目标**：
  - 本项不取消后续对具体扩展场景的讨论
  - 本项不否定扩展机制本身
- **验收标准**：
  - [x] 当前 POC 不再绑定某个未定版的具体业务场景
  - [x] 文档中明确写出“具体场景后续单独讨论”
  - [x] `resources/extensions/` 保持为通用内置扩展目录
- **状态**：[x]
