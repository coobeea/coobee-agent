# Agent 系统

Agent 是 coobee-agent 的核心概念。每个 Agent 由两部分构成：

一、定义文件 `.home/agents/{agentId}.json` — 放角色元数据（id、name、description、instructions、tools、skills、model、metadata 等），由 AgentStore 维护。

二、Agent Home 目录 `.home/agents/{agentId}/` — 放身份文件、记忆、私有技能、业务工作区与会话产物，由 AgentHomeManager 初始化。

两者同名并列存在于 `.home/agents/` 下。`<runtime_environment>` 中的 `agent_home` 字段指向目录部分。

## Agent 定义 JSON

```json
{
  "id": "code-reviewer",
  "name": "代码审查专家",
  "description": "审查代码质量与潜在问题",
  "instructions": "你是一个...",
  "tools": ["read", "search", "exec"],
  "skills": ["coding-standards"],
  "model": "openai/gpt-4o",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "createdBy": "user",
  "version": 1
}
```

`instructions` 字段会在 Agent 创建/更新时同步写入 Home 目录的 `SOUL.md`，运行时以 `SOUL.md` 为准。

内置 Agent 定义在只读的 `resources/agents/*.json`，应用启动时会合并到用户目录视图里。

不要手动改写 `{agentId}.json`，经 Gateway 的 `/gateway/agents/*` 接口或 AgentStore API 进行变更。

## Agent Home 目录结构

`AgentHomeManager.initHome(agentId)` 会自动建出：

```
{agent_home}/
├── IDENTITY.md        身份名片（你是谁、定位、风格）
├── SOUL.md            人格、价值观与系统指令（instructions 的持久落点）
├── USER.md            主人档案（谁在用你、偏好）
├── NOTES.md           环境与工具备注（项目特有约定、外部服务提醒）
├── HEARTBEAT.md       心跳任务清单（长期跟进的事项）
├── AGENTS.md          Agent 级规则与技能配置（会注入 system prompt）
├── BOOTSTRAP.md       首次初始化才生成（引导文件）
├── sessions.jsonl     会话索引（每次新建 Thread 追加一行）
├── memory/            Agent 级永久记忆（见 memory.md）
├── skills/            Agent 私有 Skill（见 skills.md）
├── workspace/         业务工作区（见 workspace.md）
└── sessions/          会话产物根（见 threads.md）
```

前 7 个 md 在会话启动时按优先级（BOOTSTRAP.md → IDENTITY.md → SOUL.md → USER.md → NOTES.md → HEARTBEAT.md）参与 system prompt 组装，你可以读也可以改，改完立刻影响下一次对话。

`AGENTS.md` 是独立的规则块，单独注入到 system prompt 的 `agent_rules` 部分。

## sessions.jsonl 索引

格式为 JSONL，每行一条：

```
{"id":"283557218403819520","createdAt":"2026-02-21T11:15:09.105Z"}
```

ThreadStore 在新建 Thread 时自动追加，不要手动编辑。查看某 Agent 的所有会话直接读这个文件即可。

## 管理入口

Agent 的 CRUD 走 HTTP Gateway：`POST/GET/PATCH/DELETE /gateway/agents/*`。前端 AI Creator 也通过这条接口自动生成定义。

你作为 Agent 自己，一般不需要修改其他 Agent 的定义。若业务需要引用其他 Agent，读 `agents_definitions` 目录下的 JSON 文件即可。

## 注意事项

一、ID 使用 kebab-case。

二、改 `SOUL.md` / `IDENTITY.md` 等 Home 文件是合法的自我演化方式，比改 `{agentId}.json.instructions` 更直接。

三、不要在 `{agent_home}` 根下自造新目录。新信息优先落到 `memory/`（永久）、`workspace/`（业务）、`workspace/memory/`（session 级）。
