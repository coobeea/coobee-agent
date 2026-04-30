# Context Instructions 快照分析：305963098406285312

分析对象：`.home/workspaces/305963098406285312/context.jsonl`

生成时间：2026-04-24

## 1. 快照结论

这个 `context.jsonl` 只有 1 行 JSONL，但这一行记录了一次完整的 Agent 调用上下文。和指令相关的内容主要分为三层：

| 层级     | JSON 字段                                  | 是否进入模型上下文     | 说明                                                  |
| -------- | ------------------------------------------ | ---------------------- | ----------------------------------------------------- |
| 基础指令 | `config.instructions`                      | 是                     | Agent 的主角色、能力、工作规范                        |
| 追加指令 | `config.appendInstructions[]`              | 是                     | 运行环境、Agent 规则、Agent Home 文件、Skill 发现提示 |
| 工具定义 | `config.tools[]` / `rawApiRequest.tools[]` | 是，但不是 system 文本 | 以 function schema 形式提供给模型                     |

本次快照里，`rawApiRequest.messages[0].content` 与下面这个拼接结果完全一致：

```text
config.instructions

appendInstructions[0]

appendInstructions[1]

appendInstructions[2]

appendInstructions[3]
```

也就是说，最终发送给模型的 system prompt 没有额外内容；工具定义则通过 `rawApiRequest.tools` 单独传入。

## 2. 快照基本信息

| 字段                             | 值                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `timestamp`                      | `2026-04-24T07:08:30.177Z`                                                       |
| `sessionId`                      | `305963098406285312`                                                             |
| `runtime`                        | `agent`                                                                          |
| `config.name`                    | `app-copilot`                                                                    |
| `config.model`                   | `gemma4:e4b`                                                                     |
| `userMessage`                    | `你好`                                                                           |
| `output`                         | `你好，我是 Coobee 管家。可以帮你管理技能和智能体。需要创建技能还是管理智能体？` |
| `duration`                       | `18707ms`                                                                        |
| `config.instructions` 字符数     | `700`                                                                            |
| `config.appendInstructions` 数量 | `4`                                                                              |
| `rawApiRequest.messages` 数量    | `2`                                                                              |
| `rawApiRequest.tools` 数量       | `12`                                                                             |

## 3. 指令块总览

| 顺序 | 字段                    | 块名                    | 字符数 | 来源/作用                                            |
| ---- | ----------------------- | ----------------------- | -----: | ---------------------------------------------------- |
| 1    | `config.instructions`   | 基础 instructions       |    700 | app-copilot 的主指令；内容与 `SOUL.md` 完全一致      |
| 2    | `appendInstructions[0]` | `<runtime_environment>` |   1284 | 当前运行时环境、路径、文件使用规则                   |
| 3    | `appendInstructions[1]` | `<agent_rules>`         |   1951 | `.home/agents/app-copilot/AGENTS.md`                 |
| 4    | `appendInstructions[2]` | `<agent_home>`          |   2286 | `.home/agents/app-copilot/` 下可注入的人格和记忆文件 |
| 5    | `appendInstructions[3]` | `<skill_discovery>`     |    310 | Skill 发现与读取方式                                 |

本次快照没有出现 `<workspace_context>`，原因是 `.home/workspaces/305963098406285312/` 根目录下没有可注入的 `.md` 上下文文件。

本次快照也没有注入全局 AGENTS 文件。当前 `PromptAssemblyService` 中 `globalAgentsMdPath` 已标记为 deprecated；从这个快照看，实际进入 prompt 的规则文件是 Agent Home 下的 `.home/agents/app-copilot/AGENTS.md`。

## 4. 基础指令：`config.instructions`

这一段是 Agent 的主系统指令，完整语义如下。

### 4.1 身份定位

Agent 被定义为 `Coobee Agent 的应用管家`，职责是通过自然语言对话管理整个应用。

### 4.2 能力范围

| 能力组     | 具体能力                                                 |
| ---------- | -------------------------------------------------------- |
| 技能管理   | 创建技能、查看技能、导入技能、删除技能                   |
| 智能体管理 | 创建智能体、修改智能体、关联技能、查看智能体、删除智能体 |
| 系统配置   | 查看配置、修改配置                                       |

技能管理的创建动作里还有一个明确要求：创建技能时要先读取 `skill-creator` 技能，了解标准格式，然后再使用 `read/write/glob` 等工具创建 `SKILL.md`。

### 4.3 工作规范

| 编号 | 规范       | 具体要求                                                                                  |
| ---- | ---------- | ----------------------------------------------------------------------------------------- |
| 1    | 主动确认   | 写操作前简要说明将要做什么，然后直接执行，不要反复询问“你确定吗”                          |
| 2    | 操作反馈   | 每次操作完成后，清晰告知结果和后续建议                                                    |
| 3    | 中文回复   | 所有回复使用中文                                                                          |
| 4    | 简洁高效   | 直奔主题，不做冗余客套，每次回复控制在 2-3 句话以内                                       |
| 5    | 纯文本输出 | 禁止 Markdown，包括标题、加粗、列表符号、代码块、表格；回复要像口语对话一样自然，适合朗读 |

### 4.4 与 `SOUL.md` 的关系

`config.instructions` 与 `.home/agents/app-copilot/SOUL.md` 的内容完全一致。本次调用中，`SOUL.md` 又通过 `<agent_home>` 再次注入了一遍，因此这一段主能力和工作规范在最终 system prompt 中出现了两次。

## 5. 追加指令 1：`<runtime_environment>`

这一段告诉模型当前 Agent 身份、运行环境、可用路径和文件使用边界。

### 5.1 Agent 信息

| 字段         | 值                                    |
| ------------ | ------------------------------------- |
| `id`         | `app-copilot`                         |
| `name`       | `app-copilot`                         |
| `Session`    | `305963098406285312`                  |
| `model`      | `ollama/gemma4:e4b (thinking=medium)` |
| `platform`   | `darwin/arm64 (dev)`                  |
| `security`   | `sandbox=path-only, exec=auto`        |
| `extensions` | `none`                                |

这里的 `name` 是 `app-copilot`，不是前端展示用的 `应用管家`。如果 UI 或消息展示需要显示中文名称，要从 Thread / Agent Definition 的显示名字段取，而不能只看 runtime prompt 里的 `name`。

### 5.2 路径信息

| 路径类型             | 值                                                                              | 语义                     |
| -------------------- | ------------------------------------------------------------------------------- | ------------------------ |
| `data_directory`     | `/Users/lifeng/git/git-coobee/coobee-agent/.home/data/app-copilot`              | 持久化业务数据           |
| `agent_home`         | `/Users/lifeng/git/git-coobee/coobee-agent/.home/agents/app-copilot`            | 身份、记忆、Agent 级配置 |
| `workspace`          | `/Users/lifeng/git/git-coobee/coobee-agent/.home/workspaces/305963098406285312` | 当前任务临时文件         |
| `config`             | `/Users/lifeng/git/git-coobee/coobee-agent/.home/config`                        | 应用配置                 |
| `skills`             | builtin=`resources/skills`，user=`.home/skills`                                 | Skill 搜索路径           |
| `agents_definitions` | `.home/agents`                                                                  | Agent 定义目录           |

### 5.3 文件使用规则

| 规则                                          | 含义                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------ |
| 业务数据保存到 `data_directory`               | 记录、报告、知识文档等持久数据应落在 Agent 数据目录                                  |
| `agent_home` 只放身份、记忆、偏好、规则和配置 | 不应把普通任务产物写入 Agent Home                                                    |
| `workspace` 用于临时任务文件和中间产物        | 当前任务相关的临时文件应放这里                                                       |
| 不要手动编辑系统管理文件                      | `sessions/`、`history.jsonl`、`events.jsonl`、`context.jsonl` 都被标记为系统管理文件 |

## 6. 追加指令 2：`<agent_rules>`

来源：`.home/agents/app-copilot/AGENTS.md`

这一段是 Agent 级规则，主要补充意图识别、执行原则、回复风格和常见场景。

### 6.1 核心职责

Agent 被要求专注于管理应用中的技能和智能体。

### 6.2 技能管理类意图

| 子意图   | 触发示例                                                                       |
| -------- | ------------------------------------------------------------------------------ |
| 创建技能 | “帮我创建一个技能”、“我想做一个xxx功能的技能”、“新建技能”、“添加一个技能叫xxx” |
| 查看技能 | “有哪些技能”、“技能列表”、“看看现有的技能”、“xxx技能的内容是什么”              |
| 导入技能 | “从xxx路径导入技能”、“把这个技能导入进来”、“导入xxx技能”                       |
| 删除技能 | “删除xxx技能”、“移除xxx技能”、“不需要xxx技能了”                                |

### 6.3 智能体管理类意图

| 子意图     | 触发示例                                                                     |
| ---------- | ---------------------------------------------------------------------------- |
| 创建智能体 | “创建一个智能体”、“新建Agent”、“我需要一个能做xxx的智能体”                   |
| 修改智能体 | “修改xxx智能体”、“更新智能体配置”、“给xxx智能体添加xxx能力”                  |
| 关联技能   | “给xxx智能体添加xxx技能”、“让xxx智能体使用xxx技能”、“移除xxx智能体的xxx技能” |
| 查看智能体 | “有哪些智能体”、“智能体列表”、“xxx智能体的配置”                              |
| 删除智能体 | “删除xxx智能体”、“移除xxx智能体”                                             |

### 6.4 系统配置类意图

触发示例包括：“查看配置”、“系统配置”、“修改xxx设置”、“当前配置是什么”。

### 6.5 询问和帮助类意图

触发示例包括：“你能做什么”、“怎么用”、“有什么功能”、“帮我”、“不知道怎么办”。

回答模板是：告诉用户可以管理技能和智能体，并给出“创建技能”、“有哪些技能”、“创建智能体”等可说的示例。

### 6.6 执行原则

| 场景         | 规则                   |
| ------------ | ---------------------- |
| 意图明确     | 直接执行，不要反复确认 |
| 意图不明确   | 通过简单提问澄清       |
| 缺少必要信息 | 主动询问缺失的关键信息 |
| 操作完成后   | 简洁反馈结果，不要啰嗦 |

### 6.7 回复风格

好的回复示例偏短句，例如“好的，开始创建。”、“已完成，技能保存在 xxx 路径。”、“要修改哪个智能体？”。

需要避免的回复包括：过度客套、反复确认、Markdown 格式、“让我来帮您...”这类客套表达。

### 6.8 常见场景处理

| 场景                 | 识别信号                   | 要求回应                                               |
| -------------------- | -------------------------- | ------------------------------------------------------ |
| 用户第一次使用       | “你好”、“在吗”             | “你好，我是 Coobee 管家。需要创建技能还是管理智能体？” |
| 用户不知道能做什么   | “你能做什么”、“有什么功能” | 简述可以创建和管理技能、创建和配置智能体，并给出示例   |
| 用户要创建但没说清楚 | 只说“创建”                 | 询问要创建技能还是智能体                               |
| 用户要查看列表       | “有哪些”、“列表”           | 直接列出，用纯文本格式                                 |

### 6.9 注意事项

| 编号 | 内容                           |
| ---- | ------------------------------ |
| 1    | 始终使用中文回复               |
| 2    | 回复要简洁，控制在 2-3 句话    |
| 3    | 不使用 Markdown 格式，用纯文本 |
| 4    | 执行前不反复确认，直接做       |
| 5    | 完成后简单反馈结果即可         |

## 7. 追加指令 3：`<agent_home>`

来源：`.home/agents/app-copilot/`

这一段把 Agent Home 中可注入的 Markdown 文件合并进 system prompt。它以说明文字开头：这些是 Agent 的持久身份和记忆文件。

### 7.1 `BOOTSTRAP.md`

| 部分     | 内容                                                               |
| -------- | ------------------------------------------------------------------ |
| 角色定位 | Coobee 应用管家，专注技能管理、智能体管理、系统配置                |
| 工作原则 | 直接执行、简洁回复、纯文本、中文交流                               |
| 初次见面 | “你好，我是 Coobee 管家，可以帮你管理技能和智能体。有什么需要吗？” |

### 7.2 `IDENTITY.md`

| 字段 | 值                   |
| ---- | -------------------- |
| 名字 | Coobee 管家          |
| 风格 | 高效、友好、简洁     |
| 签名 | 原文为一个机器人符号 |

### 7.3 `SOUL.md`

`SOUL.md` 内容与 `config.instructions` 完全一致，包括：

| 部分       | 内容                                               |
| ---------- | -------------------------------------------------- |
| 身份定位   | Coobee Agent 的应用管家                            |
| 技能管理   | 创建、查看、导入、删除技能                         |
| 智能体管理 | 创建、修改、关联技能、查看/删除智能体              |
| 系统配置   | 查看配置、修改配置                                 |
| 工作规范   | 主动确认、操作反馈、中文回复、简洁高效、纯文本输出 |

这意味着最终 prompt 中主能力说明和工作规范重复出现：第一次在 `config.instructions`，第二次在 `<agent_home>` 的 `SOUL.md`。

### 7.4 `USER.md`

| 部分     | 内容                                                       |
| -------- | ---------------------------------------------------------- |
| 称呼     | 老哥                                                       |
| 主要用途 | 管理应用的技能和智能体、快速创建和配置新功能、系统配置调整 |
| 偏好     | 喜欢简洁明了的回复、不需要过多解释、中文交流               |

### 7.5 `NOTES.md`

| 部分     | 内容                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------ |
| 常用路径 | `resources/skills/`、`.home/skills/`、`.home/agents/`、`.home/data/`                             |
| 环境说明 | macOS darwin/arm64、dev、使用 Ollama 本地模型                                                    |
| 操作提示 | 创建技能前先用 `skill_list`；修改智能体配置时直接改对应配置文件；所有操作都在 `.home` 目录下进行 |

### 7.6 `HEARTBEAT.md`

当前内容是“暂无定期任务”。

## 8. 追加指令 4：`<skill_discovery>`

这一段告诉 Agent 当前有 27 个可用 Skills，并给出发现和使用流程。

| 步骤 | 指令                                     |
| ---- | ---------------------------------------- |
| 1    | 使用 `skill_list` 发现可用 Skills        |
| 2    | 使用 `read` 读取目标 Skill 的 `SKILL.md` |
| 3    | 按照 `SKILL.md` 中的说明执行             |

这只是发现提示，不会把 27 个 Skill 的完整内容直接塞进 system prompt。

## 9. 工具定义

工具定义不属于 `instructions` 文本块，但它们也在 `context.jsonl` 中记录，并通过 `rawApiRequest.tools` 传给模型。本次共有 12 个工具：

| 工具         | 作用                                         |
| ------------ | -------------------------------------------- |
| `read`       | 读取文件内容，支持 offset/limit              |
| `write`      | 写入完整文件内容，文件存在时覆盖             |
| `edit`       | 按唯一精确文本匹配替换文件内容               |
| `exec`       | 执行 shell 命令，支持前台和后台              |
| `process`    | 管理后台进程                                 |
| `memory`     | 搜索和管理 Agent/session 两级记忆            |
| `search`     | 搜索工作区文件内容                           |
| `glob`       | 按文件名 pattern 查找文件                    |
| `skill_list` | 列出可用 Skills 的名称、说明和路径           |
| `task_plan`  | 创建和更新结构化任务计划 ⚠️ 已删除           |
| `todo_write` | 创建和管理当前 session 的 TODO 列表          |
| `emit_event` | 向 UI 发送事件，例如打开预览、打开文件、通知 |

## 10. 组合来源和代码路径

从当前代码看，这些内容大致由以下位置组合：

| 内容                          | 代码位置                                             | 说明                                                                                                      |
| ----------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 基础 `instructions`           | `src/main/agent/execution/ThreadExecutionFactory.ts` | 读取 Agent 定义后调用 `builder.instructions(agent.instructions)`                                          |
| `<runtime_environment>`       | `src/main/agent/AgentEnv.ts`                         | `formatRuntimePaths(env)` 生成运行环境块                                                                  |
| `appendInstructions` 组装顺序 | `src/main/agent/prompt/PromptAssemblyService.ts`     | 顺序为 runtime paths、agent rules、agent home、workspace context、skill discovery、extension instructions |
| `<agent_home>`                | `src/main/agent/agents/AgentHomeManager.ts`          | 读取 Agent Home 中可注入 Markdown 文件                                                                    |
| 最终 system prompt 拼装       | `src/main/agent/runtime/types.ts`                    | `buildInstructions()` 的顺序是 instructions -> skills -> appendInstructions                               |

本次快照里没有单独注入 Agent skills 的完整内容，因此最终 raw system prompt 等于 `instructions + appendInstructions`。如果后续 Agent 配置了 `skills`，还需要额外分析 `skills` 是否会被插入到 `instructions` 和 `appendInstructions` 之间。

## 11. 观察到的问题

### 11.1 `config.instructions` 与 `SOUL.md` 重复

`config.instructions` 与 `.home/agents/app-copilot/SOUL.md` 完全一致，而 `SOUL.md` 又被 `<agent_home>` 注入，所以这段内容在最终 system prompt 里重复出现。重复内容包括身份定位、三类能力和五条工作规范。

### 11.2 回复格式要求与系统实际展示可能冲突

指令中多次要求“纯文本输出，禁止 Markdown”，但应用 UI 本身支持消息块、代码块、工具卡片等结构化展示。这个规则对 `app-copilot` 这种管家型 Agent 可以成立，但如果复用到其他任务型 Agent，可能会限制正常输出。

### 11.3 `runtime_environment` 里的 `name` 不是显示名

`runtime_environment` 里 `name=app-copilot`，但 Thread 中展示名通常可能是 `应用管家`。如果前端或后续逻辑用 prompt 快照里的 `name` 推导展示名称，会产生偏差。

### 11.4 `agent_home` 注入了“身份记忆文件”正文

`<agent_home>` 不只是告诉模型路径，还把 `BOOTSTRAP.md`、`IDENTITY.md`、`SOUL.md`、`USER.md`、`NOTES.md`、`HEARTBEAT.md` 的内容都注入了。这个设计有利于人格和偏好稳定，但也会让 prompt 中同时出现“配置说明”和“行为指令”，边界需要保持清楚。

### 11.5 没有注入全局 AGENTS.md

这个快照没有全局 `.home/agents.md` 一类内容。进入 prompt 的规则是 Agent Home 内的 `AGENTS.md`，这和当前 `PromptAssemblyService` 中全局字段 deprecated 的方向一致。

## 12. 不遗漏清单

本次文档已经覆盖以下 context 指令内容：

| 内容                                            | 已覆盖 |
| ----------------------------------------------- | ------ |
| `config.instructions` 身份定位                  | 是     |
| `config.instructions` 技能管理                  | 是     |
| `config.instructions` 智能体管理                | 是     |
| `config.instructions` 系统配置                  | 是     |
| `config.instructions` 五条工作规范              | 是     |
| `<runtime_environment>` Agent 信息              | 是     |
| `<runtime_environment>` Paths                   | 是     |
| `<runtime_environment>` File usage              | 是     |
| `<agent_rules>` 核心职责                        | 是     |
| `<agent_rules>` 技能管理意图                    | 是     |
| `<agent_rules>` 智能体管理意图                  | 是     |
| `<agent_rules>` 系统配置意图                    | 是     |
| `<agent_rules>` 询问帮助意图                    | 是     |
| `<agent_rules>` 执行原则                        | 是     |
| `<agent_rules>` 回复风格                        | 是     |
| `<agent_rules>` 常见场景                        | 是     |
| `<agent_rules>` 注意事项                        | 是     |
| `<agent_home>` BOOTSTRAP.md                     | 是     |
| `<agent_home>` IDENTITY.md                      | 是     |
| `<agent_home>` SOUL.md                          | 是     |
| `<agent_home>` USER.md                          | 是     |
| `<agent_home>` NOTES.md                         | 是     |
| `<agent_home>` HEARTBEAT.md                     | 是     |
| `<skill_discovery>` Skill 数量和使用流程        | 是     |
| `config.tools` / `rawApiRequest.tools` 工具定义 | 是     |
| `rawApiRequest.messages[0].content` 拼接关系    | 是     |
