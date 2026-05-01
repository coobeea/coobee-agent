# Skill 系统

Skill 是场景化的操作手册——一段 markdown 文档，告诉你遇到某种场景时应该怎么做。`<runtime_environment>` 中的 `skill_search_paths` 字段会列出当前会话能看到的全部 Skill 来源。

## 5 级搜索路径（从低到高）

同名 Skill 高优先级覆盖低优先级：

一、**system**（内置）：`resources/skills/`。随应用分发，只读。

二、**extension**（扩展贡献）：各 Extension 在 manifest 里声明的 skills 目录。只读。

三、**marketplace**（市场/用户安装）：`.home/skills/`。用户从技能市场装的或自己写的。

四、**agent**（Agent 私有）：`.home/agents/{agentId}/skills/`。绑定到当前 Agent，跨会话保留。

五、**session**（会话级临时）：`{project}/skills/`（即 `.home/agents/{agentId}/project/skills/`）。优先级最高，可用于临时实验。

每条路径的来源标签（`label`）和 kind（`system` / `extension` / `marketplace` / `agent` / `session`）都会随 `skill_search_paths` 注入。

## Skill 目录结构

```
my-skill/
├── SKILL.md              必需 — frontmatter + 指令正文
├── references/           可选 — 拆分出的详细参考
│   └── detail.md
└── scripts/              可选 — 辅助脚本（可通过 exec 调用）
    └── helper.sh
```

## SKILL.md 格式

```markdown
---
name: my-skill
description: 一句话告诉系统何时使用此 Skill（description 决定触发场景）
---

# Skill 标题

## 使用场景

描述何时应该用这个 Skill。

## 操作步骤

1. 第一步
2. 第二步

## 注意事项

- 边界
```

`name` 用 kebab-case；`description` 要精准——它是 LLM 选择是否加载此 Skill 的判据。

## 需要外部资源的 Skill

在 frontmatter 里声明 `config` 字段：

```markdown
---
name: paddle-ocr
description: 使用 PaddleOCR 进行文字识别
config:
  - key: apiKey
    description: PaddleOCR API Key
    required: true
  - key: baseUrl
    description: API 地址
    required: false
    default: https://api.example.com
---
```

配置值放在 `{userHome}/config/skills.json5`：

```json5
{
  'paddle-ocr': {
    apiKey: 'sk-xxx',
    baseUrl: 'https://api.example.com'
  }
}
```

## Skill 脚本环境变量

通过 `exec` 工具调用 Skill 里 `scripts/` 下的脚本时，以下环境变量可用：

- `COOBEE_CONFIG_DIR` — 全局 config 目录（读 skills.json5）
- `COOBEE_PROJECT` — 当前业务项目目录（推荐）
- `COOBEE_WORKSPACE` — 已废弃，值等于 `COOBEE_PROJECT`，仅兼容旧脚本
- `COOBEE_SESSION_ID` — 当前会话 ID
- `COOBEE_USER_HOME` — userHome 根
- `COOBEE_MEMORY_DIR` — 当前会话可见的记忆目录

Bash 示例：

```bash
#!/bin/bash
CONFIG_FILE="$COOBEE_CONFIG_DIR/skills.json5"
[ -f "$CONFIG_FILE" ] || { echo "config missing" >&2; exit 1; }
```

## 新建 Skill 的落点选择

- 当前会话试验 → `{project}/skills/my-skill/`
- 固定给这个 Agent 用 → `{agent_home}/skills/my-skill/`
- 想给所有 Agent 共享 → `.home/skills/my-skill/`
- 不要往 `resources/skills/` 写（只读）

## 注意事项

一、新建前先查 `skill_search_paths`，避免重复。

二、`description` 写清楚触发条件，避免和其他 Skill 冲突。

三、Skill 的正文尽量短，详细内容拆到 `references/` 下按需加载，节省 token。
