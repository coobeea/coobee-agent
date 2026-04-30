# 工作区（Workspace）

`<runtime_environment>` 中的 `workspace` 指向 `.home/agents/{agentId}/workspace/`，是当前 Agent 的业务工作区。

## 两个语义，一个目录

- `workspace` — 工具默认 cwd。你跑 `exec` / `read` / `write` 等工具时，相对路径都基于这里。
- `data_directory` — Agent 持久业务数据目录。面向工具输出、报告、索引、长期资料时语义更贴切。

当前实现里 `data_directory === workspace`，都指 `agent_home/workspace/`。两个字段名只是语义差异，不是不同目录。

## 和 session_dir 的边界

`workspace/` 跨会话共享，是这个 Agent 的"长期桌面"。

`session_dir` 每次会话独立，只装当次对话的产物（history / events / context / todos / 子会话）。

判断原则：内容下次还用，写 `workspace/`；内容只属于当前对话，不用写任何地方（系统会自动记录到 `session_dir`）。

## 内部约定结构

`workspace/` 下**不会**被系统自动创建任何子目录。你想怎么组织就怎么组织，但建议遵循这几条惯例：

- `workspace/memory/` — session 级记忆落点。memory 工具 `scope: 'session'` 写入这里（由 memory-thread 扩展维护，你也可以直接读）。
- `workspace/skills/` — 当前工作区临时 Skill，优先级最高（见 skills.md）。
- `workspace/reports/`、`workspace/output/`、`workspace/data/` 等 — 按需自建。

不要期待以下目录存在（它们是老 layout 的遗物）：`workspace/sessions/`、`workspace/contexts/`、`workspace/events/`、`workspace/tasks/`、`workspace/logs/`、`workspace/extensions/`。这些目录要么已迁到 `session_dir`，要么对应的工具已不存在。

## 使用指南

生成一份报告：写到 `${workspace}/reports/2026-04.md`。

持久索引/缓存：写到 `${workspace}/data/` 下的子目录。

临时中间文件：可以用系统 `temp`（你通过 `<runtime_environment>` 外的工具环境变量拿到），或者在 `${workspace}/tmp/` 下临时放，但记得清理。

新 Skill：写到 `${workspace}/skills/my-skill/SKILL.md`（会话级），或写到 `${agent_home}/skills/...`（Agent 级，跨会话）。

## 边界

一、`workspace/` 是读写自由区，不做路径守卫（除非沙箱模式另行启用）。

二、不要在 `workspace/` 下建和系统已有路径同名的目录（如 `workspace/.home/`、`workspace/agents/`），容易误导后续读者。

三、多会话并发时 `workspace/` 是共享的。如果有并发冲突风险，自己加时间戳或 sessionId 后缀，不要依赖隔离。
