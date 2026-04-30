# Agent Home 运行目录重定义 - TODO

## 1. 定义 Agent 运行目录布局对象

- **目标**：统一表达 Agent Home、Agent workspace、session 目录，避免各模块手写路径。
- **背景/原因**：当前 `.home/workspaces/{threadId}`、`.home/data/{agentId}`、`.home/agents/{agentId}` 分散拼装，容易再次路径漂移。
- **涉及范围**：
  - `src/main/agent/context/AgentContextResolver.ts`
  - 可选新增：`src/main/agent/context/AgentRuntimeLayout.ts`
- **具体动作**：
  - 定义 `agentHomePath = .home/agents/{agentId}`。
  - 定义 `agentWorkspacePath = .home/agents/{agentId}/workspace`。
  - 定义 `dataDirectory = agentWorkspacePath`。
  - 定义 `sessionDir = .home/agents/{agentId}/sessions/{sessionId}`。
  - 定义 `agentSkillsPath = .home/agents/{agentId}/skills`。
  - 确保新目录按需创建。
  - 旧路径不进入运行期布局对象，避免调用方继续依赖。
- **非目标**：
  - 不新增 `skill_exec` 工具。
- **验收标准**：
  - [x] Resolver 返回的新默认 `dataDirectory` 是 `.home/agents/{agentId}/workspace`。
  - [x] Resolver 返回的新默认 `sessionDir` 是 `.home/agents/{agentId}/sessions/{sessionId}`。
  - [x] 目录创建失败时直接抛错，不静默兜底。
- **状态**：[x] 已完成

## 2. 一次性处理旧业务数据目录

- **目标**：把旧 `.home/data/{agentId}` 从主流程中移除；如需保留数据，只做一次性迁移。
- **背景/原因**：旧业务数据目录已经不再符合新 Agent 自包含模型。
- **涉及范围**：
  - `src/main/agent/context/AgentContextResolver.ts`
  - 一次性迁移或清理测试
- **具体动作**：
  - 如果旧默认目录存在且需要保留，则迁移到新默认目录。
  - 已存在同名文件时不覆盖，记录 warn。
  - 迁移完成后删除空旧目录。
  - 旧 `metadata.dataDirectory` 不再影响默认运行目录；如发现旧字段，记录迁移/废弃日志。
  - 主流程不再读取 `.home/data/{agentId}`。
- **验收标准**：
  - [x] 旧默认目录中的文件被搬到 Agent workspace。
  - [x] 目标已有文件时不会被覆盖。
  - [x] 主流程不再 fallback 到 `.home/data/{agentId}`。
  - [x] 旧 `metadata.dataDirectory` 不再改变默认工作区。
- **状态**：[x] 已完成

## 3. 改造工具执行上下文 cwd

- **目标**：让普通工具默认在 `.home/agents/{agentId}/workspace` 下执行和写入。
- **背景/原因**：Skill 脚本执行产物需要稳定进入业务工作区，而不是散落到会话目录或 Agent Home 根。
- **涉及范围**：
  - `src/main/agent/AgentEnvInjector.ts`
  - `src/main/agent/sandbox/*`
  - `src/main/agent/tools/types.ts`
- **具体动作**：
  - `prepared.workspace` / `workspaceRoot` 指向 Agent workspace。
  - `toolCtx.cwd` 指向 Agent workspace。
  - path-only sandbox 的主边界使用 Agent workspace。
  - 如需读取 Skill 文件，通过已有 `read`/SkillManager 暴露路径，不把 Agent Home 根设为可写边界。
- **验收标准**：
  - [x] `exec pwd` 输出 Agent workspace。
  - [x] 相对路径写入文件落到 Agent workspace。
  - [x] 工具不会默认把文件写到 Agent Home 根目录。
- **状态**：[x] 已完成

## 4. 改造会话运行产物目录

- **目标**：把会话历史、事件、上下文写入 `.home/agents/{agentId}/sessions/{threadId}`。
- **背景/原因**：旧 `.home/workspaces/{threadId}` 让会话产物脱离 Agent Home，迁移和排查不直观。
- **涉及范围**：
  - `src/main/agent/threads/ThreadStore.ts`
  - `src/main/agent/streaming/consumers/EventWriter.ts`
  - `src/main/agent/streaming/consumers/HistoryWriter.ts`
  - `src/main/routes/ThreadRoutes.ts`
  - `src/main/agent/runtime/pimono/PiMonoSessionPaths.ts`
- **具体动作**：
  - 新 Thread 创建时创建 `.home/agents/{agentId}/sessions/{threadId}`。
  - `HistoryWriter` 写新 session 目录下的 `history.jsonl`。
  - `EventWriter` 写新 session 目录下的 `events.jsonl`。
  - `context.jsonl` 写入同一 session 目录。
  - Thread 历史只读取新路径，不 fallback 到旧 `.home/workspaces/{threadId}`。
  - 如需保留旧历史，在实施前或启动迁移阶段一次性搬迁。
  - PiMono/OpenAI session 文件继续收纳在 session root 下的 `sessions/` 子目录。
- **验收标准**：
  - [x] 新会话不再写 `.home/workspaces/{threadId}`。
  - [x] 新会话历史能正常展示。
  - [x] 主流程不再读取旧 `.home/workspaces/{threadId}`。
- **状态**：[x] 已完成

## 5. 梳理 Thread 路径字段语义

- **目标**：避免 `workspacePath` 同时表示工具 workspace 和会话产物目录，并去掉旧语义。
- **背景/原因**：新模型下工具 cwd 是 Agent workspace，而 Thread 的历史目录是 session dir，两者不是同一个路径。
- **涉及范围**：
  - `src/main/agent/threads/types.ts`
  - `src/shared/events/thread.ts`
  - 前端依赖 `workspacePath` 的位置
- **具体动作**：
  - 评估新增 `sessionPath`、`agentWorkspacePath` 字段。
  - 明确 `workspacePath` 是否废弃，或只保留为新语义字段。
  - 更新事件和接口文档。
- **验收标准**：
  - [x] 前端不再误把 Thread session path 当成工具 cwd。
  - [x] 前端和事件消费方按新字段语义工作。
- **状态**：[x] 已完成

## 6. 更新 runtime prompt 和环境变量

- **目标**：让模型明确知道哪些目录用于身份、业务数据、会话产物和技能。
- **背景/原因**：如果提示词仍写 `.home/data/{agentId}` 或 `.home/workspaces/{threadId}`，模型会继续使用旧目录。
- **涉及范围**：
  - `src/main/agent/AgentEnv.ts`
  - `src/main/agent/AgentEnvInjector.ts`
  - `resources/skills/runtime-env/references/*`
  - `docs/05-architecture/*`
- **具体动作**：
  - `COOBEE_WORKSPACE` 指向 Agent workspace。
  - `COOBEE_DATA_DIRECTORY` 指向 Agent workspace。
  - 增加或明确 `COOBEE_SESSION_DIR`。
  - prompt 中解释 `agent_home`、`workspace/data_directory`、`session_dir`、`skills`。
  - 删除旧 `.home/data/{agentId}` 和 `.home/workspaces/{threadId}` 的主动推荐。
- **验收标准**：
  - [x] 新 prompt 不再推荐旧业务数据目录。
  - [x] 模型能看到 session dir 和 workspace 的区别。
- **状态**：[x] 已完成

## 7. 更新文件路由和上传边界

- **目标**：确认上传、复制、删除等文件操作应落到 Agent workspace 还是当前 session 目录。
- **背景/原因**：`FileRoutes` 当前可能以全局 `workspacesDir` 为安全边界，新模型需要重新定义边界。
- **涉及范围**：
  - `src/main/routes/FileRoutes.ts`
  - 前端文件上传调用点
- **具体动作**：
  - 梳理文件上传是否属于业务数据，默认落到 Agent workspace。
  - 如果某些文件属于会话附件，则落到当前 session 目录下的明确子目录。
  - 更新路径安全判断。
- **验收标准**：
  - [x] 上传业务文件不会进入旧 `.home/workspaces`。
  - [x] 路径校验仍能阻止越权写入。
- **状态**：[x] 已完成

## 8. 补充测试和一次性迁移验证

- **目标**：用测试锁定新目录语义。
- **背景/原因**：这次改动涉及路径边界，回归风险主要来自隐式路径拼装。
- **涉及范围**：
  - `src/main/agent/context/__tests__/*`
  - `src/main/agent/threads/__tests__/*`
  - `src/main/agent/sandbox/__tests__/*`
  - `src/main/agent/streaming/__tests__/*`
- **具体动作**：
  - 增加 Resolver 默认路径测试。
  - 增加旧 data 一次性迁移或清理测试。
  - 增加旧 workspaces 不再被主流程读取的测试。
  - 增加 Thread session 目录创建测试。
  - 增加 Event/History 写入新路径测试。
  - 增加工具 cwd 测试。
- **验收标准**：
  - [x] 相关单元测试通过。
  - [x] `git diff --check` 通过。
- **状态**：[x] 已完成
