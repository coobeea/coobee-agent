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

## 已完成

- [x] Task 1 — AgentRuntimeLayout 切换到 project 目录（commit 992ca47）
- [x] Task 2 — workspace → project 一次性迁移（commit 992ca47）
- [x] Task 3 — Runtime prompt 和环境变量（commit 992ca47）
- [x] Task 4 — SkillSearchPathKind `'workspace'` → `'session'`（commit 992ca47）
- [x] Task 5 — 前端最小适配
  - ThreadView.vue / ThreadViewDual.vue：DirectoryMode + rightTab `'workspace'` → `'session'`
  - ProjectPanel.vue：import 路径 + DirectoryMode
  - AgentEditorView.vue：帮助文档文案 workspace → project
  - useWorkspaceWatcher.ts → useProjectWatcher.ts（git mv）
- [x] Task 6 — 文档和内置 Skill 最小同步
  - runtime-env/references/workspace.md → project.md（git mv + 内容重写）
  - 11 个 SKILL.md 文件 `{workspace}` → `{project}`
  - skills.md：kind `'workspace'` → `'session'`，COOBEE_WORKSPACE 标为废弃
- [x] Task 7 — 验证和收尾
  - grep 残留检查：`workspace_context` 0 残留 ✅
  - grep 残留检查：SkillSearchPathKind `'workspace'` 0 残留 ✅
  - tsc --noEmit 编译通过 ✅
  - SkillManager 全部 39 测试通过 ✅
  - 全量测试：970 passed / 65 failed（全部为预存问题，与 V1 无关）

## 验证结果摘要

| 检查项                             | 结果                                      |
| ---------------------------------- | ----------------------------------------- |
| `workspace_context` 残留           | 0 matches ✅                              |
| SkillSearchPathKind `'workspace'`  | 0 matches ✅                              |
| `{workspace}` in resources/skills/ | 0 matches ✅                              |
| TypeScript 编译                    | 通过 ✅                                   |
| SkillManager 测试                  | 39/39 通过 ✅                             |
| 全量测试（1036 例）                | 970 passed, 65 failed（预存，非 V1 引入） |

## 当前结论

V1 实施完成。所有 7 项 Task 均已交付。剩余 `workspace` 字符串均为：内部类型名（ExtensionOrigin）、迁移兼容路径（legacy handler）、sandbox Docker workdir（`/workspace`）、Gateway 事件名（workspace.file-changed）— 均在 V1 定义的非目标范围内。
