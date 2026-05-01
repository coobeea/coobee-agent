# workspace/project 命名收敛 V1 · TODO

## 当前状态

方向已从“全仓库 workspace 清零”调整为“V1 收窄落地”。本轮不等待额外拍板，默认按 `03-反思优化.md` 中固定决策执行。

## Task 1 — AgentRuntimeLayout 切换到 project 目录

- **目标**：让 Agent 业务目录的物理路径变为 `.home/agents/{agentId}/project/`。
- **背景/原因**：这是用户和 LLM 最容易理解的业务目录名称，也是后续 prompt 收敛的基础。
- **涉及范围**：
  - `src/main/agent/context/AgentRuntimeLayout.ts`
  - `src/main/agent/context/AgentContextResolver.ts`
  - `src/main/agent/threads/ThreadStore.ts`
  - `src/shared/events/thread.ts`
- **具体动作**：
  - 新增/改名 `agentProjectPath`。
  - `dataDirectory` 指向 `agentProjectPath`。
  - Thread 列表事件新增 `projectPath`。
  - 如保留 `workspacePath`，只能作为 deprecated alias，值等于 `projectPath`。
- **非目标**：
  - 不改 sandbox/tool 里的 `workspaceRoot`。
- **验收标准**：
  - [ ] 新建 Agent/Thread 后创建 `.home/agents/{agentId}/project/`。
  - [ ] 运行时工具 cwd 指向 project 目录。
  - [ ] UI 和 prompt 不再展示 `workspacePath` 作为业务目录名。
- **状态**：[ ]

## Task 2 — 实现 workspace → project 一次性迁移

- **目标**：把旧 `.home/agents/{agentId}/workspace/` 安全搬到 `project/`。
- **背景/原因**：物理目录改名不能让用户历史业务数据不可见。
- **涉及范围**：
  - 新增迁移模块，例如 `src/main/agent/context/AgentProjectMigration.ts`
  - 启动 ready hook
  - 相关单元测试
- **具体动作**：
  - 启动早期扫描 `.home/agents/*/workspace/`。
  - 预扫描阶段检查冲突：目标 `project/` 已存在且源非空时中止并报错。
  - 优先 `rename`，跨设备失败时使用 `cp` + 校验 + 删除源。
  - 成功后写 `.home/.migration-agent-project-v1.json`。
  - 迁移日志记录 source、target、文件数、结果。
- **非目标**：
  - 不保留 workspace/project 双写。
  - 不自动猜测无法归属的旧 `.home/workspaces/*` 目录。
- **验收标准**：
  - [ ] 有旧 workspace 时可迁到 project。
  - [ ] 目标冲突时不会覆盖用户文件。
  - [ ] 迁移失败不会静默进入空项目目录。
- **状态**：[ ]

## Task 3 — Runtime prompt 和环境变量改为 project 叙事

- **目标**：让 LLM 只看到 project 作为业务目录概念。
- **背景/原因**：LLM 的路径理解主要来自 `<runtime_environment>` 和 prompt block。
- **涉及范围**：
  - `src/main/agent/AgentEnv.ts`
  - `src/main/agent/AgentEnvInjector.ts`
  - `src/main/agent/prompt/PromptAssemblyService.ts`
- **具体动作**：
  - `<runtime_environment>` 输出 `project`。
  - 保留 `data_directory`，但说明它等于 project。
  - 新增 `COOBEE_PROJECT`。
  - `<workspace_context>` 改为 `<project_context>`。
  - `readWorkspaceContextFiles` 改名为 `readProjectContextFiles`。
- **非目标**：
  - 不要求内部变量 `workspaceRoot` 全部改名。
- **验收标准**：
  - [ ] runtime prompt 不再用 workspace 表示业务目录。
  - [ ] project 根目录 Markdown 能被 `<project_context>` 注入。
  - [ ] 技能脚本可以通过 `COOBEE_PROJECT` 获取业务目录。
- **状态**：[ ]

## Task 4 — SkillSearchPathKind 第五档改为 session

- **目标**：消除 Skill 搜索来源里的 workspace 歧义。
- **背景/原因**：该来源表达会话作用域，不是 Agent 业务项目。
- **涉及范围**：
  - `src/main/agent/skills/SkillManager.ts`
  - SkillManager 相关测试
  - Skill discovery 输出文案
- **具体动作**：
  - `SkillSearchPathKind` 中 `'workspace'` 改为 `'session'`。
  - label 改为 `Session skills` 或中文“会话技能”。
  - 更新所有 `kind === 'workspace'` 判断。
- **验收标准**：
  - [ ] Skill discovery 不再出现 workspace 类型来源。
  - [ ] SkillManager 测试通过。
- **状态**：[ ]

## Task 5 — 前端最小字段和文案适配

- **目标**：让前端优先消费 `projectPath`，用户界面使用“项目/业务项目”。
- **背景/原因**：前端已经有 ProjectPanel，但字段消费仍可能依赖 workspacePath。
- **涉及范围**：
  - `src/renderer/src/components/agent/ProjectPanel.vue`
  - `src/renderer/src/views/ThreadView.vue`
  - `src/renderer/src/views/ThreadViewDual.vue`
  - `src/renderer/src/stores/threads.ts`
  - `src/renderer/src/composables/useWorkspaceWatcher.ts`
- **具体动作**：
  - Thread 类型和 store 优先使用 `projectPath`。
  - UI 标题避免“任务工作目录/工作区”，统一为“项目/业务项目”。
  - `useWorkspaceWatcher` 可在本轮 `git mv` 为 `useProjectWatcher`，但不强制事件枚举全量改名。
- **验收标准**：
  - [ ] 文件面板能打开 Agent project 目录。
  - [ ] UI 不把 session 目录叫项目。
  - [ ] 没有用户可见的“workspace 工作区”残留。
- **状态**：[ ]

## Task 6 — 文档和内置 Skill 最小同步

- **目标**：更新会影响模型行为的活跃文档。
- **背景/原因**：Skill 文档里仍使用 `{workspace}` 会继续诱导模型写旧路径。
- **涉及范围**：
  - `resources/skills/asr/SKILL.md`
  - `resources/skills/tts/SKILL.md`
  - `resources/skills/skill-creator/SKILL.md`
  - `resources/skills/system-config/references/self-improvement.md`
  - 本 POC 文档
- **具体动作**：
  - 推荐变量从 `{workspace}` 改为 `{project}`。
  - 说明 `{project}` 来自 `COOBEE_PROJECT`。
  - 历史 reference snapshot 不批量改。
- **验收标准**：
  - [ ] 活跃 Skill 文档不再推荐 `{workspace}` 写业务产物。
  - [ ] 已结案历史文档未被机械污染。
- **状态**：[ ]

## Task 7 — 验证和收尾

- **目标**：确保 V1 改动可运行、可回滚、可解释。
- **涉及范围**：
  - 单元测试
  - grep 检查
  - POC 进度文件
- **具体动作**：
  - 跑路径布局、迁移、prompt、SkillManager、ThreadStore、前端类型相关测试。
  - grep 检查禁止残留：
    - prompt 中的 `workspace_context`
    - Skill kind 字面量 `'workspace'`
    - 新建目录字符串 `'/workspace'` 用于 Agent business dir
  - 更新 `05-PROGRESS.md` 和 `06-BUGS.md`。
- **验收标准**：
  - [ ] 关键测试通过。
  - [ ] `git diff --check` 通过。
  - [ ] POC 状态更新完整。
- **状态**：[ ]
