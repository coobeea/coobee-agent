# Agent Home 运行目录重定义 - PROGRESS

## 2026-04-30

- 创建 POC 目录：`pocs/agent-home-runtime-layout`。
- 完成需求分析、方案设计、反思优化和 TODO 初稿。
- 根据用户反馈更新方案：不做旧路径运行期兼容，新目录模型作为唯一模型。
- 已进入实现阶段并完成首版改造：
  - 新增 `AgentRuntimeLayout`，统一定义 Agent Home、业务工作区、会话目录、技能目录。
  - `AgentContextResolver`、`AgentEnvInjector`、`AgentExecutor`、`ThreadlessExecutor` 已切换到 `.home/agents/{agentId}/workspace` 和 `.home/agents/{agentId}/sessions/{sessionId}`。
  - `ThreadStore`、线程事件、前端 Thread 视图字段语义已同步：`workspacePath` 表示 Agent 业务工作区，新增 `agentWorkspacePath` 与 `sessionPath`。
  - `HistoryWriter`、`EventWriter`、`ThreadRoutes` 已改为读取/写入 Agent Home 下的 session 目录。
  - `FileRoutes` 上传、复制、删除边界改为 Agent Homes 范围，不再以全局 `.home/workspaces` 为安全根。
  - 智能体编辑页已移除旧 `metadata.dataDirectory` 配置入口，改为展示固定业务工作区语义。
  - 已执行一次性本地数据迁移：可识别的旧 `.home/data/{agentId}` 与 `.home/workspaces/{threadId}` 内容已移动到新布局。
- 当前状态：实现完成，进入验证和残留风险确认。
- 验证结果：
  - `pnpm exec eslint ...` 通过。
  - `pnpm exec vitest run src/main/agent/context/__tests__/AgentContextResolver.test.ts src/main/agent/threads/__tests__/ThreadStore.enhanced.test.ts src/main/agent/runtime/pimono/__tests__/PiMonoSessionPaths.test.ts src/main/agent/streaming/__tests__/StreamConsumersWriters.test.ts src/main/agent/sandbox/__tests__/path-guard.test.ts` 通过，5 个测试文件，99 个用例。
  - `git diff --check` 通过。
  - `pnpm run typecheck:web` 与 `pnpm run typecheck:node` 未通过，失败点为当前仓库既有类型问题，已记录到 `06-BUGS.md`。

## 待确认事项

- `workspacePath` 已保留为 Agent 业务工作区语义；同时新增 `agentWorkspacePath` 与 `sessionPath` 让语义更清楚。
- 旧 `metadata.dataDirectory` 当前只记录废弃日志，不参与路径决策。
- 文件上传/复制/删除默认限制在 Agent Homes 范围；具体目标目录由前端传入的 Agent Home 或业务工作区决定。
- 存在一个无法关联到 thread 定义的旧 `.home/workspaces/307549385198301184` 目录，暂不自动猜测迁移目标。
