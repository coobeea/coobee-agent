# AppendInstructions 内容说明

## 概述

`appendInstructions` 是系统自动注入到 Agent System Prompt 的附加指令，包含运行时环境信息、Skill 发现提示等。这些内容会追加到用户配置的 `instructions` 之后。

## 完整内容示例

以下是一个真实的 `appendInstructions` 示例（来自 `context.jsonl`）：

> **📁 路径说明**
>
> 文档中的路径分为两部分：
>
> - **项目根目录**: `/Users/lifeng/git/git-coobee/coobee-agent/`
> - **相对路径**: 从项目根目录开始的相对路径（如 `.home/workspaces/...`）
>
> 完整路径 = 项目根目录 + 相对路径

### 1. Runtime Environment（运行时环境）

```xml
<runtime_environment>
Your Runtime Environment:

- Agent ID: agent-mo04s0eg
- Agent Name: 增值税
- Session: 305265776047321088
- 数据目录 (Data Dir): .home/data/agent-mo04s0eg
- Internal Workspace: .home/workspaces/305265776047321088
  (项目根目录: /Users/lifeng/git/git-coobee/coobee-agent/)
- Platform: darwin/arm64 (dev)
- Security: sandbox=path-only, exec=auto
- Model: ollama/gemma4:e4b (thinking=medium)
- Extensions: none

Directory Structure:

📂 **数据目录 / Data Directory (IMPORTANT)**: .home/data/agent-mo04s0eg/
  (如果 Agent 配置了 dataDirectory)

  ⚠️ **这是你的专属数据存储区，非常重要！**

  **用途**：
  - 持久化存储所有业务数据（客户信息、进销存记录、知识库、文档等）
  - 跨任务、跨会话的数据共享（今天保存的数据，明天仍可访问）
  - 这是固定的目录，不会因为任务结束而清理

  **何时使用**：
  - 用户要求保存、记录、存储任何业务数据时 → 保存到数据目录
  - 用户询问"之前的记录""历史数据""上次的文件"时 → 从数据目录读取
  - 生成报表、分析结果、知识文档时 → 保存到数据目录

  **路径**: .home/data/agent-mo04s0eg

**Agent Home (Your Root Directory)**: .home/agents/agent-mo04s0eg/
  (每个 Agent 都有自己的 Home 目录)
  ├── IDENTITY.md                           — 身份名片：名字、风格、签名
  ├── SOUL.md                               — 核心灵魂：行为原则、风格定调
  ├── USER.md                               — 主人档案：用户称呼、偏好
  ├── NOTES.md                              — 环境工具备注：特殊配置
  ├── HEARTBEAT.md                          — 心跳任务清单：定期任务
  ├── AGENTS.md                             — Agent 级规则 + 技能配置
  └── BOOTSTRAP.md                          — 引导文件（初始化配置）

  **PURPOSE**: Agent 的人格配置和记忆文件。这些 Markdown 文件定义了 Agent 的身份、
  行为原则、用户偏好等。系统会将这些文件的内容注入到 System Prompt 中。

**Current Task Workspace (Internal/Temporary)**: .home/workspaces/305265776047321088/
  (相对于项目根目录)
  ├── sessions/                             — SDK session files
  │   ├── session.jsonl                         (OpenAI)
  │   └── {timestamp}_{uuid}.jsonl              (PiMono)
  ├── history.jsonl                         — Aggregated message history (frontend display)
  ├── events.jsonl                          — Debug event logs
  ├── context.jsonl                         — Context snapshots (append-only)
  └── tasks/                                — Multi-agent collaboration area (optional, created by task_plan tool)

  **PURPOSE**: This is the internal sandbox for the CURRENT task.
  Files here are task-specific and may be cleaned up after task completion.

Key System Directories:
- Data Directory: .home/data/{agentId}          — Agent 专属数据目录（业务数据持久化）
- Agent Home: .home/agents/{agentId}            — Agent 配置和记忆文件
- Config: .home/config                          — 全局配置
- Skills: builtin=resources/skills, user=.home/skills  — Skills 搜索路径
- Agents Definitions: .home/agents              — Agent 定义文件目录
(以上均为相对于项目根目录的路径)

File Output Guidelines:

**Where to save files?**

1. **数据目录（首选！业务数据持久化）** → .home/data/agent-mo04s0eg/
   ⚠️ 优先级最高！所有业务数据都应保存到这里！
   - 客户信息、进销存记录、知识库、分析报告、文档等
   - 跨任务的持久化数据，下次开启新任务时可以继续访问
   - 这是智能体专属的固定数据存储位置
   - 用户要求"保存数据""记录信息""生成报告"时，默认使用此目录

2. **Agent Home（配置和记忆）** → .home/agents/agent-mo04s0eg/
   - IDENTITY.md      — 身份名片
   - SOUL.md          — 核心灵魂和行为原则
   - USER.md          — 用户偏好和使用习惯
   - NOTES.md         — 环境备注和特殊配置
   - HEARTBEAT.md     — 定期检查任务
   - AGENTS.md        — Agent 级规则和技能配置

3. **Temporary Task Files** → Current Task Workspace
   - .home/workspaces/305265776047321088/  — 临时文件、中间结果
   - 任务结束后可能被清理

4. **System Files** (DO NOT manually modify)
   - {workspace}/sessions/         — Session data (managed by system)
   - {workspace}/history.jsonl     — Aggregated history (managed by system)
   - {workspace}/events.jsonl      — Event logs (managed by system)
   - {workspace}/context.jsonl     — Context snapshots (managed by system)

**重要提示**：你有专属的数据目录 `.home/data/agent-mo04s0eg`，所有业务数据都应保存到这里！
</runtime_environment>
```

### 2. Skill Discovery（技能发现提示）

```xml
<skill_discovery>
You have 27 Skills available. Use the `skill_list` tool to discover them.

**How to use Skills**:
1. Use `skill_list` to find available skills
2. Use `read` tool to read the skill's SKILL.md file (path provided by skill_list)
3. Follow the instructions in the SKILL.md file
</skill_discovery>
```

## 生成机制

### 生成位置

**文件**: `src/main/agent/AgentEnvInjector.ts`

**函数**: `injectEnv(sessionId: string, builder: AgentBuilder)`

### 生成流程

```typescript
// 1. 构建运行时环境信息
const agentEnv = await buildAgentEnv(sessionId, workspace, agentHome);

// 2. 格式化为 XML 块
const runtimePathsBlock = formatRuntimePaths(agentEnv);

// 3. 生成 Skill 发现提示
const skillDiscoveryHint =
  skillManager.size > 0
    ? `<skill_discovery>\n` +
      `You have ${skillManager.size} Skills available. Use the \`skill_list\` tool to discover them.\n\n` +
      `**How to use Skills**:\n` +
      `1. Use \`skill_list\` to find available skills\n` +
      `2. Use \`read\` tool to read the skill's SKILL.md file (path provided by skill_list)\n` +
      `3. Follow the instructions in the SKILL.md file\n` +
      `</skill_discovery>`
    : '';

// 4. 注入到 Builder
builder.appendInstructions(
  runtimePathsBlock,
  skillDiscoveryHint
  // ... 其他内容
);
```

## 各部分详解

### Runtime Environment 各字段说明

#### 基础信息

| 字段                | 示例值                                | 说明                                       |
| ------------------- | ------------------------------------- | ------------------------------------------ |
| Agent ID            | `agent-mo04s0eg`                      | Agent 的唯一标识符（可选）                 |
| Agent Name          | `增值税`                              | Agent 的显示名称（可选）                   |
| Session             | `305265776047321088`                  | 当前会话的 Snowflake ID                    |
| 数据目录 (Data Dir) | `.home/data/agent-mo04s0eg`           | Agent 专属数据存储目录                     |
| Internal Workspace  | `.home/workspaces/{sessionId}`        | 当前任务的工作空间路径（相对于项目根目录） |
| Platform            | `darwin/arm64 (dev)`                  | 操作系统/架构/环境                         |
| Security            | `sandbox=path-only, exec=auto`        | 沙箱模式和命令审批策略                     |
| Model               | `ollama/gemma4:e4b (thinking=medium)` | 使用的模型和思维链级别                     |
| Extensions          | `none` 或扩展列表                     | 已加载的 Extension                         |

#### 目录结构

**Data Directory (数据目录)**: Agent 专属的持久化数据存储 ⚠️ **非常重要！**

- 路径: `.home/data/{agentId}/`
- 用途:
  - 持久化存储所有业务数据（客户信息、进销存记录、知识库、文档等）
  - 跨任务、跨会话的数据共享（今天保存的数据，明天仍可访问）
  - 这是固定的目录，不会因为任务结束而清理
- 何时使用:
  - 用户要求保存、记录、存储任何业务数据时 → 保存到数据目录
  - 用户询问"之前的记录""历史数据""上次的文件"时 → 从数据目录读取
  - 生成报表、分析结果、知识文档时 → 保存到数据目录
- 配置: 在 Agent 定义的 `metadata.dataDirectory` 中指定
- 优先级: **最高**！所有业务数据首选此目录

**Agent Home**: Agent 的人格配置和记忆文件

- 路径: `.home/agents/{agentId}/`
- 包含文件（全部为 Markdown 格式）:
  - `IDENTITY.md` - 身份名片：名字、风格、签名
  - `SOUL.md` - 核心灵魂：行为原则、风格定调
  - `USER.md` - 主人档案：用户称呼、偏好
  - `NOTES.md` - 环境工具备注：特殊配置
  - `HEARTBEAT.md` - 心跳任务清单：定期任务
  - `AGENTS.md` - Agent 级规则 + 技能配置
  - `BOOTSTRAP.md` - 引导文件（初始化配置）
- 注入机制: `BOOTSTRAP.md`、`IDENTITY.md`、`SOUL.md`、`USER.md`、`NOTES.md`、`HEARTBEAT.md` 注入到 `<agent_home>`；`AGENTS.md` 通过独立的 `<agent_rules>` 注入
- 优先级: BOOTSTRAP → IDENTITY → SOUL → USER → NOTES → HEARTBEAT

**Current Task Workspace**: 当前任务的临时工作空间

- 路径: `.home/workspaces/{sessionId}/`
- `sessions/` - SDK 会话文件（OpenAI/PiMono）
- `history.jsonl` - 聚合的消息历史（供前端展示）
- `events.jsonl` - 调试事件流
- `context.jsonl` - 上下文快照（追加式）
- `tasks/` - 多 Agent 协作区（可选，由 task_plan 工具创建）

**Key System Directories**: 关键系统目录

- `Config` - 全局配置文件目录
- `Skills` - Skill 搜索路径（builtin + user）
- `Agents Definitions` - Agent 定义文件目录（JSON 配置）

#### 文件输出指南

告诉 Agent 在不同场景下应该把文件保存到哪里：

1. **数据目录（首选！业务数据持久化）** ⚠️ 优先级最高
   - 所有业务数据都应保存到这里
   - 存储内容: 客户信息、进销存记录、知识库、分析报告、文档等
   - 持久化特点: 跨任务、跨会话的持久化数据
   - 何时使用:
     · 用户要求保存、记录、存储任何业务数据时 → 保存到数据目录
     · 用户询问"之前的记录""历史数据""上次的文件"时 → 从数据目录读取
     · 生成报表、分析结果、知识文档时 → 保存到数据目录
   - 默认使用场景: 用户要求"保存数据""记录信息""生成报告"

2. **Agent Home（配置和记忆）**
   - Agent 的人格配置文件（IDENTITY.md, SOUL.md, USER.md 等）
   - Agent 级规则和技能配置（AGENTS.md）
   - 环境备注和定期任务（NOTES.md, HEARTBEAT.md）
   - 注意: 这些是配置文件，不应该存储业务数据

3. **Temporary Task Files（临时任务文件）**
   - 当前任务的中间结果
   - 任务结束后可能被清理

4. **System Files（系统文件）**
   - 由系统管理，Agent 不应手动修改

### Skill Discovery 说明

这是一个简化的提示，告诉 Agent：

1. 有多少个 Skills 可用（示例中是 27 个）
2. 如何使用 Skills（3 步流程）

**注意**: 这里只是提示，不包含 Skills 的完整内容。Skills 的完整定义在 `config.skills` 数组中。

## 生成代码位置

### formatRuntimePaths()

**文件**: `src/main/agent/AgentEnv.ts:238-376`

**功能**: 将 `AgentEnv` 对象格式化为 XML 格式的运行时环境说明

**关键逻辑**:

```typescript
export function formatRuntimePaths(env: AgentEnv): string {
  // 格式化扩展列表
  const extensionsList = env.loadedExtensions.length > 0 ? env.loadedExtensions.join(', ') : 'none';

  // Agent Home 部分（如果有）
  const agentHomeSection = env.agentHome ? `...` : '';

  // 数据目录部分（如果有）
  const dataDirectorySection = env.dataDirectory ? `...` : '';

  // 工程目录部分（如果有）
  const projectDirSection = env.projectDir ? `...` : '';

  // 组装完整的 XML 块
  return `<runtime_environment>
Your Runtime Environment:
${env.agentId ? `- Agent ID: ${env.agentId}` : ''}
${env.agentName ? `- Agent Name: ${env.agentName}` : ''}
- Session: ${env.sessionId}
// ... 更多字段
</runtime_environment>`;
}
```

### 注入时机

```
AgentExecutor.execute()
    ↓
injectEnv(sessionId, builder)
    ↓
buildAgentEnv() → 构建 AgentEnv 对象
    ↓
formatRuntimePaths(agentEnv) → 生成 runtime_environment XML
    ↓
builder.appendInstructions(runtimePathsBlock, ...)
    ↓
Runtime 构建时包含在 System Prompt 中
```

## 动态内容

以下内容会根据实际情况动态生成：

### 1. 会话相关

- Session ID（每次执行不同）
- Workspace 路径（基于 Session ID）

### 2. 平台相关

- Platform（darwin/linux/win32）
- Architecture（arm64/x64）
- Environment（dev/prod）

### 3. Agent 相关（如果有 agentId）

- Agent ID
- Agent Name
- Agent Home 路径
- Data Directory（如果配置了）
- Project Directory（如果配置了）

### 4. Extension 相关

- 已加载的 Extension 列表

### 5. Skills 相关

- 可用 Skills 数量（示例中是 27 个）

## 用途

### 1. 提供上下文感知

让 Agent 了解自己运行的环境：

- 当前工作目录
- 可用的系统目录
- 文件保存位置

### 2. 指导文件操作

明确告诉 Agent 在不同场景下应该把文件保存到哪里：

- 持久化数据 → Agent Home 或 Data Directory
- 临时文件 → Workspace
- 系统文件 → 不要手动修改

### 3. 支持调试

提供完整的环境信息，方便：

- 理解 Agent 的执行上下文
- 追溯文件路径
- 分析路径相关问题

### 4. 技能发现

提示 Agent 如何使用 Skills 系统。

## 完整的 System Prompt 结构

最终发送给 LLM 的 System Prompt 结构如下：

```
[用户配置的 instructions]
你是一个 AI 助手。

[appendInstructions[0] - runtime_environment]
<runtime_environment>
Your Runtime Environment:
- Session: ...
- Internal Workspace: ...
...
</runtime_environment>

[appendInstructions[1] - agent_rules]
<agent_rules>
Agent-level rules...
</agent_rules>

[appendInstructions[2] - agent_home]
<agent_home>
Agent identity and memory files...
</agent_home>

[appendInstructions[3] - skill_discovery]
<skill_discovery>
You have 27 Skills available...
</skill_discovery>

[appendInstructions[2] - 其他注入内容]
...
```

## Context Snapshot 中的记录

在 `context.jsonl` 中，`appendInstructions` 作为数组记录：

```json
{
  "config": {
    "instructions": "你是一个 AI 助手。",
    "appendInstructions": [
      "<runtime_environment>\nYour Runtime Environment:\n...",
      "<skill_discovery>\nYou have 27 Skills available..."
    ]
  }
}
```

## 相关问题

### Q1: 为什么要使用 XML 标签？

A: XML 标签（如 `<runtime_environment>`）可以：

- 结构化内容，让 LLM 更容易理解
- 明确区分不同类型的信息
- 支持未来的解析和提取

### Q2: appendInstructions 可以自定义吗？

A: 部分可以。用户可以通过：

- Extension 系统注入自定义指令
- Agent Home 中的特殊文件（SOUL.md, USER.md 等）
- Workspace 上下文文件

但核心的 `runtime_environment` 和 `skill_discovery` 是系统自动生成的。

### Q3: 这些信息会消耗 token 吗？

A: 是的。`appendInstructions` 的内容会包含在每次 LLM 调用的 System Prompt 中，会消耗 input tokens。

本例中的 `runtime_environment` 大约消耗 800-1000 tokens（英文）。

### Q4: 可以禁用 appendInstructions 吗？

A: 不建议。这些信息对 Agent 正确执行任务很重要。如果使用 `lightweight: true` 模式（聊天模式），会跳过大部分注入。

## 相关文件

- `src/main/agent/AgentEnv.ts` - AgentEnv 类型定义和 `formatRuntimePaths()`
- `src/main/agent/AgentEnvInjector.ts` - `injectEnv()` 主逻辑
- `src/main/agent/runtime/ContextSnapshotWriter.ts` - Context Snapshot 写入

## 相关文档

- [核心 Skills 自动注入机制](./core-skills-injection.md)
- [Context Snapshot Agent 信息问题](../issues/context-snapshot-agent-info-issues.md)

---

**文档版本**: 1.0  
**最后更新**: 2026-04-22  
**维护者**: AI Assistant
