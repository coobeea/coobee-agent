# Prompt 组合结构整理 - 进度跟踪

> 创建时间：2026-04-23
> 当前状态：已完成

## 总体进度

| 阶段     | 状态   | 说明                     |
| -------- | ------ | ------------------------ |
| 需求分析 | 已完成 | 明确不做用户内容重复检测 |
| 方案设计 | 已完成 | 选定中策                 |
| 实施开发 | 已完成 | prompt 组合规则已收敛    |
| 验证     | 已完成 | 定向验证通过             |

## 进度记录

### 2026-04-23

- ✅ 确认需求边界：不处理 `instructions`、`SOUL.md`、`AGENTS.md` 的语义重复检测。
- ✅ 确认核心改动：去掉全局 `.home/agents.md` 注入，整理系统生成 block。
- ✅ `PromptAssemblyService` 改为只读取 Agent Home 下的 `AGENTS.md`，输出 `<agent_rules>`。
- ✅ `AgentHomeManager.readInjectableFiles()` 不再把 `AGENTS.md` 放进 `<agent_home>`。
- ✅ `runtime_environment` 已精简为 Agent 元信息、关键路径和文件使用规则。
- ✅ 定向测试通过：`2 passed`，`21 passed`。
- ✅ 定向 eslint 通过。
- ✅ `pnpm run typecheck:node` 通过。
