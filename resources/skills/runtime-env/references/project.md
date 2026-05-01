# 业务项目（Project）

`<runtime_environment>` 中的 `project` 指向 `.home/agents/{agentId}/project/`，是当前 Agent 的业务项目目录。

## 两个语义，一个目录

- `project` — 工具默认 cwd。你跑 `exec` / `read` / `write` 等工具时，相对路径都基于这里。
- `data_directory` — Agent 持久业务数据目录。面向工具输出、报告、索引、长期资料时语义更贴切。

当前实现里 `data_directory === project`，都指 `agent_home/project/`。两个字段名只是语义差异，不是不同目录。

## 和 session_dir 的边界

`project/` 跨会话共享，是这个 Agent 的"长期桌面"。

`session_dir` 每次会话独立，只装当次对话的产物（history / events / context / todos / 子会话）。

判断原则：内容下次还用，写 `project/`；内容只属于当前对话，不用写任何地方（系统会自动记录到 `session_dir`）。

## 内部约定结构

`project/` 下**不会**被系统自动创建任何子目录。你想怎么组织就怎么组织，但建议遵循这几条惯例：

- `project/memory/` — session 级记忆落点。memory 工具 `scope: 'session'` 写入这里（由 memory-thread 扩展维护，你也可以直接读）。
- `project/skills/` — 当前会话临时 Skill，优先级最高（见 skills.md）。
- `project/reports/`、`project/output/`、`project/data/` 等 — 按需自建。

不要期待以下目录存在（它们是老 layout 的遗物）：`project/sessions/`、`project/contexts/`、`project/events/`、`project/tasks/`、`project/logs/`、`project/extensions/`。这些目录要么已迁到 `session_dir`，要么对应的工具已不存在。

## 使用指南

生成一份报告：写到 `${project}/reports/2026-04.md`。

持久索引/缓存：写到 `${project}/data/` 下的子目录。

临时中间文件：可以用系统 `temp`（你通过 `<runtime_environment>` 外的工具环境变量拿到），或者在 `${project}/tmp/` 下临时放，但记得清理。

新 Skill：写到 `${project}/skills/my-skill/SKILL.md`（会话级），或写到 `${agent_home}/skills/...`（Agent 级，跨会话）。

## 环境变量

- `COOBEE_PROJECT` — 推荐使用，指向 Agent 业务项目目录。
- `COOBEE_WORKSPACE` — 已废弃，值等于 `COOBEE_PROJECT`，仅用于兼容旧脚本。新脚本请用 `COOBEE_PROJECT`。

## 边界

一、`project/` 是读写自由区，不做路径守卫（除非沙箱模式另行启用）。

二、不要在 `project/` 下建和系统已有路径同名的目录（如 `project/.home/`、`project/agents/`），容易误导后续读者。

三、多会话并发时 `project/` 是共享的。如果有并发冲突风险，自己加时间戳或 sessionId 后缀，不要依赖隔离。
