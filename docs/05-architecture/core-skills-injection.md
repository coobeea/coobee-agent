# 核心 Skills 自动注入机制（历史归档）

> 最后更新：2026-04-23

本文档仅作为历史记录保留。核心 Skills 强制注入机制已经废弃，当前运行时不会再因为 `CORE_SKILLS` 常量而隐式给所有 Agent 注入基础技能。

## 当前状态

- `src/main/agent/skills/CoreSkills.ts` 已移除。
- 兼容代码被移动到 `src/main/agent/skills/legacy/CoreSkills.ts`，并标记为 `@deprecated`。
- `src/main/agent/skills/__tests__/CoreSkills.test.ts` 已删除。
- 新代码不应再依赖 `CORE_SKILLS`、`ensureCoreSkills()` 或 `loadCoreSkillDefinitions()`。

## 当前 Skill 来源

运行时可用 Skill 由以下来源共同决定：

1. Agent 配置中的 `skills` 数组。
2. Extension 通过 manifest 声明贡献的 Skill 目录。
3. 用户级 Skill 目录。
4. Workspace / Agent Home 级 Skill 目录。

Agent 不再拥有“系统自动补齐”的强制核心 Skill 集合。空 `skills` 配置就是空配置，具体能发现哪些 Skill 取决于当前搜索路径和 `skill_list` 工具。

## 历史机制

旧机制曾经维护过一个固定列表：

```typescript
['execution-protocol', 'self-reflection', 'eval-refine-loop', 'brain', 'dimension-architect'];
```

旧设计会把这些 Skill 自动放入运行时，目的是保证所有 Agent 都具备基础工作流能力。但这个模型带来了几个问题：

- Agent 配置和实际运行时不一致。
- 用户无法从配置文件判断最终会加载哪些 Skill。
- `skills: []` 的语义不清晰。
- 文档、测试和代码会误导后续维护者以为仍存在隐式核心能力层。

## 迁移指引

- 如果某个 Agent 仍需要这些基础能力，请显式写入该 Agent 的 `skills` 配置。
- 如果旧代码仍从 `skills` 模块导入 `CORE_SKILLS`，需要迁移到显式推荐列表或 UI 层配置。
- `legacy/CoreSkills.ts` 仅用于短期兼容，不应作为新功能依赖。

## 相关文档

- [Skills 注入机制重大变更](./skills-injection-change.md)
- [Agent 模块梳理与优化建议](./agent-module-review.md)
