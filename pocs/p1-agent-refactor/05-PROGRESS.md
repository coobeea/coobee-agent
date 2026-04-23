# Agent 模块 P1 阶段重构 - 执行进度

> 创建时间：2026-04-22
> 最后更新：2026-04-23
> 当前状态：代码改造和文档同步已完成，仓库级收尾项待单独处理
> 方案：上策（完整重构）

## 进度概览

| 阶段                | 状态     | 说明                                                                                               |
| ------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| 阶段 1：基础模块    | 已完成   | `AgentContextResolver`、`ThreadExecutionFactory`、lifecycle priority 已落地                        |
| 阶段 2：集成改动    | 已完成   | ChatRoutes / ThreadWaker / AgentEnvInjector / Store 已完成接入                                     |
| 阶段 3：事件统一    | 已完成   | `AgentEventWriter` 收敛为 EventBus 适配层，OpenAI Runtime 改为统一 yield                           |
| 阶段 4：Prompt 优化 | 已完成   | `PromptAssemblyService` 落地并接入，PiMono 双重注入移除                                            |
| 阶段 5：文档和测试  | 基本完成 | 文档、P1 定向 eslint、Node typecheck、全量测试完成；web typecheck 和全仓库 lint 受仓库既有问题影响 |

## 关键产出

### 代码改造

- 新增 `src/main/agent/prompt/PromptAssemblyService.ts`
- 新增 `src/main/agent/prompt/__tests__/PromptAssemblyService.test.ts`
- 新增 `src/main/agent/__tests__/AgentEventWriter.test.ts`
- 更新 `src/main/agent/AgentEnvInjector.ts`
- 更新 `src/main/agent/AgentEventWriter.ts`
- 更新 `src/main/agent/runtime/openai/OpenAIAgentRuntime.ts`
- 更新 `src/main/agent/runtime/pimono/PiMonoAgentRuntime.ts`
- 更新 `src/main/agent/runtime/types.ts`

### 文档改造

- 更新 `docs/architecture/agent-module-review.md`
- 更新 `docs/architecture/agent-execution-flow.md`
- 更新 `src/main/agent/README.md`
- 新增 `docs/architecture/agent-p1-services.md`

## 时间轴

### 2026-04-22

#### POC 初始化与阶段 1-2 完成

- ✅ 创建 `pocs/p1-agent-refactor/` 目录及 6 份阶段文档
- ✅ 完成 `AgentContextResolver`
- ✅ 完成 `ThreadExecutionFactory`
- ✅ 完成 `ReadyGatewayHook.priority = 45`
- ✅ 完成 `AgentStore` / `ThreadStore` / `AgentEnvInjector` / `ChatRoutes` / `ThreadWaker` 集成

### 2026-04-23

#### 阶段 3：事件链路统一

- ✅ `AgentEventWriter` 重构为 EventBus 兼容适配层
- ✅ 子会话事件会额外转发到主 Thread，并携带 `subSessionId`
- ✅ 补充 `AgentEventWriter` 单元测试
- ✅ OpenAI Runtime 移除直接 `streamEmitter` 业务转发
- ✅ `agent_updated` 改为 `agent:updated` chunk
- ✅ 工具 `onUpdate` 改为 `tool:delta` chunk

#### 阶段 4：Prompt 拼装优化

- ✅ 新增 `PromptAssemblyService`
- ✅ 固定 prompt block 顺序：runtime paths -> AGENTS.md -> agent home -> workspace context -> skill discovery -> extension instructions
- ✅ 增加默认字符预算和 token 估算
- ✅ `AgentEnvInjector` 改为调用 `PromptAssemblyService`
- ✅ PiMono Runtime 保留 `resourceLoader.getSkills()`，移除技能摘要二次注入
- ✅ 补充 `PromptAssemblyService` 单元测试

#### 阶段 5：文档和验证

- ✅ 更新 `agent-module-review.md`，明确：
  - runtime 入口仍写死 `piMono()`，属于后续设计题
  - 扩展点不止 start / end 两类，但 Runtime 级 hook 时机仍待讨论
  - Thread / Session / History / Events 边界漂移的具体表现
- ✅ 重写 `agent-execution-flow.md`
- ✅ 重写 `src/main/agent/README.md`
- ✅ 新增 `agent-p1-services.md`
- ✅ P1 相关文件定向 eslint 通过
- ✅ `pnpm run typecheck:node` 通过
- ✅ `pnpm test` 通过：`66 passed | 6 skipped`，`894 passed | 54 skipped`
- ⚠️ `pnpm run typecheck:web` 失败，属于仓库既有前端类型问题
- ⚠️ `pnpm run lint` 失败，属于仓库既有 lint 问题

## 验证结果

### 通过项

- `pnpm run typecheck:node`
- P1 相关文件定向 `eslint`
- `pnpm test`
- 定向测试：
  - `AgentEventWriter.test.ts`
  - `PromptAssemblyService.test.ts`
  - `OpenAIAgentRuntime.test.ts`
  - `PiMonoAgentRuntime.test.ts`
  - `ThreadExecutionFactory.test.ts`
  - `ThreadWaker.integration.test.ts`

### 未全绿项

- `pnpm run typecheck:web`
  - 典型问题：`AgentsPanel.vue`、`MarkdownPreview.vue`、`VoicePanel.vue`、`ThreadView.vue`
- `pnpm run lint`
  - 典型问题：前端 `no-unused-vars` / `no-explicit-any` / `explicit-function-return-type`
  - 也包含部分历史 Node 侧测试代码风格问题

## 当前判断

- P1 代码改造目标已经完成，主链路已按设计收敛。
- 本次新增改动没有引入 Node 侧类型错误、P1 lint 问题或测试回归。
- 仓库当前还存在与本次改动无直接关系的 `typecheck:web` / `lint` 历史问题，需要单独治理。
- Git 提交和 PR 本轮未执行，待后续统一处理。
