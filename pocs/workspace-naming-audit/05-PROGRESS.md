# workspace/project 命名收敛 V1 · 进度

## 当前阶段

POC 已从“整体重命名版”调整为“V1 收窄落地版”。

本版核心是三件事：

1. Agent 业务目录物理名从 `workspace/` 改为 `project/`。
2. Runtime prompt 和模型可见文档使用 `project`。
3. SkillSearchPathKind 的 `'workspace'` 改为 `'session'`。

## 已完成

- [x] 识别原方案风险：全仓库 workspace 清零范围过大。
- [x] 明确 V1 非目标：不改 `workspaceRoot`、不全量改 API 字段、不批量改历史文档。
- [x] 固定 V1 决策：
  - Skill kind 改 `'session'`
  - prompt block 改 `<project_context>`
  - 旧 `.home/workspaces` 迁移逻辑暂保留为一次性历史迁移能力
  - 采用单个窄 PR
  - 迁移入口放启动早期 hook
- [x] 重写需求分析、方案设计、反思优化、TODO。

## 未启动

- [ ] Task 1 — AgentRuntimeLayout 切换到 project 目录
- [ ] Task 2 — workspace → project 一次性迁移
- [ ] Task 3 — Runtime prompt 和环境变量
- [ ] Task 4 — SkillSearchPathKind 改名
- [ ] Task 5 — 前端最小适配
- [ ] Task 6 — 文档和内置 Skill 最小同步
- [ ] Task 7 — 验证和收尾

## 当前结论

可以进入 V1 实施。实施时不要被“grep workspace 清零”牵着走，只处理本 POC 定义的高价值边界。
