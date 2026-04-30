---
name: runtime-env
description: 描述 Agent 运行时的真实目录结构、路径字段与可用资源。当你（Agent）需要了解文件该写在哪里、会话产物落点、技能与扩展来源、记忆如何组织、Worker 如何工作时，读本技能下的对应 reference。
---

# Runtime Environment

## 你的坐标

你运行在 coobee-agent 里。每次被唤起时，系统会在系统提示的 `<runtime_environment>` 块中注入你当前会话的坐标，包括：

- `Agent.id` / `Agent.name` — 你是谁
- `Agent.Session` — 当前会话 ID（= threadId）
- `data_directory` — Agent 持久业务数据目录
- `session_dir` — 当前会话的产物目录（系统管理，勿改）
- `agent_home` — 你的身份、记忆、Agent 级配置所在目录
- `workspace` — 工具默认 cwd 与持久业务工作区
- `config` — 全局配置目录
- `skill_search_paths` — 当前会话可见的 Skill 来源（已按优先级排序）
- `agents_definitions` — 用户 Agent 定义目录

所有路径以这个块为准。不要硬编码 `~/.coobee-agent/...` 等字面量。

## 真实布局速览

```
.home/                            # userHome（dev: 项目/.home；prod: ~/.coobee-agent）
├── config/                       # 全局配置与 secrets
├── agents/
│   ├── {agentId}.json            # Agent 定义（id/name/instructions/tools/skills/model）
│   └── {agentId}/                # Agent Home（与定义同名的目录）
│       ├── IDENTITY.md SOUL.md USER.md NOTES.md HEARTBEAT.md AGENTS.md BOOTSTRAP.md
│       ├── sessions.jsonl        # 会话追加索引
│       ├── memory/               # Agent 级永久记忆
│       ├── skills/               # Agent 私有 Skill
│       ├── workspace/            # agent_home/workspace/ ← workspace & data_directory
│       │   └── memory/           # session 级记忆落点
│       └── sessions/
│           └── {sessionId}/      # ← session_dir：history/events/context/todos/子会话
├── threads/{threadId}.json       # Thread 定义（sessionId 恒等 threadId）
├── skills/                       # 用户/市场安装的 Skill
├── extensions/                   # 用户 Extension
├── workers/{name}/               # Worker 运行产物（可写：config/venv/data/cache）
└── models/                       # Worker 共享模型仓库
```

Worker 的源码脚本在只读的 `resources/workers/{name}/`，和 `.home/workers/` 是两个层次。

## 各主题 reference 索引

按需读取对应文件，不用全部加载。

- [路径系统 paths.md](./references/paths.md) — `<runtime_environment>` 注入字段对照表、`.home/` 真实布局、写入规则
- [Agent 系统 agents.md](./references/agents.md) — Agent 定义 JSON + Agent Home 目录形态、七个标准 md、创建与委托入口
- [会话线程 threads.md](./references/threads.md) — Thread 存储、sessionId 恒等规则、sessions.jsonl 索引、sessionDir 概念
- [工作区 workspace.md](./references/workspace.md) — `workspace` 与 `data_directory` 的真实含义、与 `session_dir` 的边界、可写/不可写指引
- [记忆系统 memory.md](./references/memory.md) — `agent` 与 `session` 两级记忆的真实路径、memory 工具的 action/scope 语义
- [Skill 系统 skills.md](./references/skills.md) — 5 级搜索路径、SKILL.md 规范、skill 环境变量
- [Extension 系统 extensions.md](./references/extensions.md) — 真实两级加载（builtin + user）、manifest、能力清单
- [Worker 子进程 workers.md](./references/workers.md) — 脚本只读 / 运行产物可写的双层结构、控制 worker 的正确路径

## 三条铁律

一、会话产物由系统管理：`session_dir/history.jsonl`、`session_dir/events.jsonl`、`session_dir/context.jsonl`、`session_dir/sessions/` 这些文件与目录你不要手动改写或删除。

二、路径用注入字段别硬编码。`<runtime_environment>` 里给你的字段名就是真相，自己拼路径容易和真实 layout 脱节。

三、不确定的目录不要乱建。如果你想建新目录，应落在 `workspace/` 或 `agent_home/memory/` 的合法子目录下；不要在 `.home/` 根、`session_dir` 根、`resources/` 下自造新目录。
