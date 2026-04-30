# 路径系统

本文件是路径事实清单。`<runtime_environment>` 注入块里写的字段名就是你该用的坐标。

## `<runtime_environment>` 注入字段

系统在每次执行前会注入下面这些字段（不为空时才会出现在提示里）：

- `Agent.id` — 当前 Agent ID。
- `Agent.name` — 当前 Agent 显示名。
- `Agent.Session` — 当前会话 ID，与 threadId 恒等。
- `model` — 生效的模型；`thinking` 为推理档位。
- `platform` — 形如 `darwin/arm64 (dev)`。
- `security` — sandbox 模式与 exec 审批策略。
- `extensions` — 本次已加载的 Extension id 列表。

路径字段：

- `data_directory` — Agent 持久业务数据目录。当前实现中它与 `workspace` 指向同一目录（`agent_home/workspace/`），语义偏重"数据"。面向工具输出与长期资料时用这个字段名表达语义。
- `session_dir` — 当前会话的产物目录。系统写入 `history.jsonl` / `events.jsonl` / `context.jsonl` / `todos.json` 和子会话 `sessions/`。
- `agent_home` — Agent Home 目录，装身份、记忆、Agent 级配置。
- `workspace` — 工具默认 cwd，也是持久业务工作区。和 `data_directory` 指向同一处。
- `config` — 全局配置目录（`coobee.json5` / `secrets.json5` / `skills.json5`）。
- `skill_search_paths` — 当前会话可见的 Skill 源，按优先级列出。
- `agents_definitions` — 用户 Agent 定义目录（`.home/agents/`）。

## `.home/` 真实布局

`userHome` 根在开发态是 `<项目>/.home/`，生产态是 `~/.coobee-agent/`。

```
.home/
├── config/                         # 全局配置（coobee.json5 / secrets.json5 / skills.json5）
├── agents/
│   ├── {agentId}.json              # Agent 定义（JSON 单文件）
│   └── {agentId}/                  # 同名 Agent Home 目录
│       ├── IDENTITY.md             # 身份名片
│       ├── SOUL.md                 # 人格与价值观（= Agent.instructions 的持久落点）
│       ├── USER.md                 # 主人档案
│       ├── NOTES.md                # 环境与工具备注
│       ├── HEARTBEAT.md            # 心跳任务清单
│       ├── AGENTS.md               # Agent 级规则与技能配置
│       ├── BOOTSTRAP.md            # 首次初始化才生成
│       ├── sessions.jsonl          # 会话追加索引（每次新建 thread 追加一行）
│       ├── memory/                 # Agent 级永久记忆
│       ├── skills/                 # Agent 私有 Skill
│       ├── workspace/              # = workspace / data_directory
│       │   └── memory/             # session 级记忆落点（由 memory-thread 扩展写）
│       └── sessions/
│           └── {sessionId}/        # = session_dir
│               ├── history.jsonl   # 历史（系统写）
│               ├── events.jsonl    # 事件（系统写）
│               ├── context.jsonl   # 上下文快照（系统写）
│               ├── todos.json      # 当前 todo 列表（todo-write 工具写）
│               └── sessions/       # 子会话产物
├── threads/
│   └── {threadId}.json             # Thread 定义（sessionId 恒等 threadId）
├── skills/                         # 用户/市场安装的 Skill
├── extensions/                     # 用户 Extension
├── workers/
│   └── {name}/                     # Worker 运行产物（可写）
│       ├── config.json             # 用户可写配置（非 worker.json）
│       ├── source/                 # 用户源码副本
│       ├── venv/                   # Python 虚拟环境
│       ├── data/                   # Worker 数据
│       └── cache/                  # Worker 缓存
└── models/                         # Worker 共享模型仓库（或由 VITE_MODEL_DIR 指向）
```

Worker 脚本本体在只读的 `resources/workers/{name}/`（含 `worker.json`、`server.py`、`requirements.txt`），和 `.home/workers/` 不是同一份。

## 写入规则

可以随意读写：`workspace/`（= `data_directory`）下的任意自建目录与文件；`agent_home/memory/` 下自己的永久记忆；`agent_home/skills/` 下自己新建的 Skill。

不要手动改写：`session_dir/history.jsonl`、`session_dir/events.jsonl`、`session_dir/context.jsonl`、`session_dir/sessions/`；`.home/agents/{agentId}.json`（由 AgentStore 统一维护）；`.home/threads/{threadId}.json`（由 ThreadStore 维护）；`resources/` 下的任意文件（打包后只读）。

不要直接碰：`config/secrets.json5`（API Key 由主进程管理）；应用内部数据目录（userData、installDir）；服务端口配置。

## 路径引用

用注入字段，不要拼字面量：

好——`${paths.agent_home}/NOTES.md`、`${paths.workspace}/reports/2025-04.md`。

差——`~/.coobee-agent/agents/foo/NOTES.md`、`/Users/xxx/.coobee-agent/...`（开发态就对不上，用户也可能用环境变量覆盖）。

## 平台差异

`platform` 字段决定本机命令约定：macOS 用 `open`，Linux 用 `xdg-open`，Windows 用 `start`。`arch` 决定可执行二进制的匹配（如 `runtime/macos-arm64/`）。
