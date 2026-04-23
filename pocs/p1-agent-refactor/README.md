# Agent 模块 P1 阶段重构 POC

> 创建时间：2026-04-22
> 最后更新：2026-04-23
> 优先级：P1
> 当前结论：P1 核心改造已完成，仓库级 web/lint 尾项待单独处理

## 概述

本轮 P1 重构围绕三件事展开：

1. 把运行期上下文和 Thread Builder 配置从业务入口里抽出来
2. 把事件链路和 Runtime 事件模型收敛到同一套抽象
3. 把 Prompt 拼装从 `AgentEnvInjector` 大函数里拆出去

对应解决的问题：

- ✅ Agent / Thread / Env 三层目录语义漂移
- ✅ 流式事件链路两套抽象
- ✅ 两套 Runtime 事件模型不一致
- ✅ Prompt 拼装链过散、PiMono 技能双重注入
- ✅ 生命周期 priority 与注释不一致
- ✅ ThreadWaker 和 ChatRoutes 的 Builder 配置重复

## 本轮产出

### 核心代码

| 改动                     | 结果                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `AgentContextResolver`   | 统一解析 `agentHomePath`、`dataDirectory`、`workspacePath`、`sessionDir`、`effectiveModel` |
| `ThreadExecutionFactory` | ChatRoutes / ThreadWaker 共用 Builder 装配逻辑                                             |
| `AgentEventWriter`       | 改为 EventBus 兼容适配层，不再直接写 `events.jsonl`                                        |
| OpenAI Runtime           | `agent_updated`、工具增量统一改为 yield `StreamChunk`                                      |
| `PromptAssemblyService`  | 统一装配 prompt blocks，并增加默认字符预算                                                 |
| PiMono Runtime           | 移除技能摘要双重注入，保留 `resourceLoader.getSkills()`                                    |

### 文档

- 更新 `docs/architecture/agent-module-review.md`
- 更新 `docs/architecture/agent-execution-flow.md`
- 更新 `src/main/agent/README.md`
- 新增 `docs/architecture/agent-p1-services.md`

## 验证结果

### 已通过

- P1 相关文件定向 `eslint`
- `pnpm run typecheck:node`
- `pnpm test`
  - `66 passed | 6 skipped`
  - `894 passed | 54 skipped`

### 未全绿

- `pnpm run typecheck:web`
  - 存在仓库既有 renderer 类型错误
- 全仓库 `pnpm run lint`
  - 存在仓库既有 lint 错误

详细见 `06-BUGS.md`。

## 当前遗留项

这些问题已经记录到架构文档里，但本轮只做记录，不继续改：

1. 路由入口仍然从 `agentExecutor.piMono()` 起手，Runtime 选择策略仍是硬编码。
2. 扩展点不止 start / end 两类，但 Runtime 级别的 hook 时机仍然偏少。
3. Thread / Session / History / Events 的持久化边界虽然已补充说明，但仍需要下一轮继续收敛。
4. 仓库级 `typecheck:web` / `lint` 基线需要单独治理。

## 文档索引

| 文件             | 说明                           |
| ---------------- | ------------------------------ |
| `01-需求分析.md` | 需求背景、目标、约束和涉及范围 |
| `02-方案设计.md` | 上中下三策与最终选型           |
| `03-反思优化.md` | 边界、安全、维护性复盘         |
| `04-TODO.md`     | 当前任务状态和完成度           |
| `05-PROGRESS.md` | 实施时间轴和验证结果           |
| `06-BUGS.md`     | 本轮遇到的问题和仓库既有阻塞项 |
