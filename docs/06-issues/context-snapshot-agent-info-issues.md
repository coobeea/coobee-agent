# Context Snapshot Agent 信息问题

## 发现日期
2026-04-22

## 问题概述
Context Snapshot（`context.jsonl`）中记录的 Agent 信息与 Agent 配置文件不一致，存在以下主要问题：

1. ✅ 当 Agent 配置的 `instructions` 为空字符串时，显示的是默认值而非空（**已修复**）
2. Agent 的 `name`（显示名称）和 `description` 字段未被正确记录（**待修复**）
3. ✅ 核心 Skills 自动注入未说明（**已修复**）

## 问题详情

### 问题 1: Instructions 默认值覆盖问题 ✅ **已修复**

> **修复日期**: 2026-04-22  
> **修复方式**: 移除默认值，改为空字符串；修改判断逻辑为 `!== undefined`

#### 现象（历史记录）
- **Agent 配置**: `agent-mo04s0eg.json` 中 `instructions` 为空字符串 `""`
- **Context 记录**: `context.jsonl` 中 `config.instructions` 显示为 `"你是一个 AI 助手。"`

#### 问题代码位置（旧代码）
**文件**: `src/main/agent/runtime/BaseAgentBuilder.ts:18`

```typescript
export abstract class BaseAgentBuilder {
  protected _name = 'agent';
  protected _mode: AgentMode = 'agent';
  protected _instructions = '你是一个 AI 助手。';  // ← 旧：默认值
  // ...
}
```

**文件**: `src/main/agent/extension/ExtensionApi.ts:192-194`

```typescript
if (agentDef.instructions) {  // ← 旧：空字符串会被判定为 false
  builder.instructions(agentDef.instructions);
}
```

#### 问题分析
1. `BaseAgentBuilder` 初始化时设置默认值 `"你是一个 AI 助手。"`
2. 当 `agentDef.instructions` 为空字符串时，`if (agentDef.instructions)` 条件为 false（空字符串是 falsy）
3. 因此 `builder.instructions()` 不会被调用，默认值保持不变
4. 这导致即使用户明确设置了空字符串，也会使用默认值

#### 修复实施

**修复日期**: 2026-04-22

**修改的文件**:
1. `src/main/agent/runtime/BaseAgentBuilder.ts:18`
   - 将默认值从 `'你是一个 AI 助手。'` 改为空字符串 `''`
   
2. `src/main/agent/extension/ExtensionApi.ts:192-194`
   - 将判断条件从 `if (agentDef.instructions)` 改为 `if (agentDef.instructions !== undefined)`
   
3. `src/main/rpc/ChatMethods.ts:139-141`
   - 同样修改判断条件
   
4. `src/main/routes/ChatRoutes.ts:178-180`
   - 同样修改判断条件
   
5. `src/main/agent/__tests__/AgentExecutor.integration.test.ts:91-93`
   - 同样修改判断条件

**新行为**:
- `instructions: ""` → 运行时使用空字符串，完全尊重用户配置
- `instructions: undefined` → 运行时使用空字符串（默认值）
- `instructions: "自定义指令"` → 运行时使用自定义指令
- 空字符串和 undefined 都被明确区分和处理

---

### 问题 2: Agent Name 和 Description 未正确记录

#### 现象

**Agent 配置文件**: `.home/agents/agent-mo04s0eg.json`
```json
{
  "id": "agent-mo04s0eg",
  "name": "增值税",
  "description": "增值税增值税增值税...",
  "instructions": "",
  // ...
}
```

**Context Snapshot 记录**: `context.jsonl`
```json
{
  "config": {
    "name": "agent-mo04s0eg",  // ← 使用的是 ID，不是 name
    // description 字段缺失
    "model": "gemma4:e4b",
    "instructions": "你是一个 AI 助手。",
    // ...
  }
}
```

#### 问题代码位置

**文件**: `src/main/agent/extension/ExtensionApi.ts:188`

```typescript
const builder = agentExecutor
  .piMono()
  .lightweight(true)
  .mode('chat')
  .name(agentId)  // ← 使用的是 agentId，不是 agentDef.name
  .sessionMode('memory')
  .maxTurns(1);
```

**文件**: `src/main/agent/runtime/ContextSnapshot.ts:133-140`

```typescript
config: {
  name: options.name,
  model: options.model || 'unknown',
  instructions: options.instructions,
  appendInstructions: options.appendInstructions,
  skills: options.skills?.map((s) => ({ name: s.name, description: s.description })),
  tools: options.tools?.map((t) => ({ name: t.name, description: t.description }))
  // ← 缺少 description 字段
},
```

#### 问题分析

1. **Name 字段问题**:
   - `ExtensionApi.ts` 调用 `builder.name(agentId)` 设置的是 Agent ID（如 `agent-mo04s0eg`）
   - 应该使用 `agentDef.name`（如 `"增值税"`）作为显示名称
   - Agent ID 应该作为单独的字段记录

2. **Description 字段缺失**:
   - `ContextSnapshot` 类型定义中的 `config` 没有 `description` 字段
   - Agent 的 `description` 字段完全没有被记录到 context.jsonl

#### 预期行为
Context Snapshot 应该完整记录 Agent 的元信息：
```json
{
  "config": {
    "agentId": "agent-mo04s0eg",
    "name": "增值税",
    "description": "增值税增值税增值税...",
    "model": "gemma4:e4b",
    "instructions": "...",
    // ...
  }
}
```

#### 建议修复方案

**步骤 1: 更新 ContextSnapshot 类型定义**

**文件**: `src/main/agent/runtime/ContextSnapshot.ts`

```typescript
export interface ContextSnapshot {
  // ...
  config: {
    /** Agent ID（唯一标识）*/
    agentId?: string;
    /** Agent 名称（显示名称）*/
    name: string;
    /** Agent 描述 */
    description?: string;
    /** 模型名称 */
    model: string;
    // ...
  };
  // ...
}
```

**步骤 2: 传递完整的 Agent 信息**

**文件**: `src/main/agent/extension/ExtensionApi.ts`

```typescript
const builder = agentExecutor
  .piMono()
  .lightweight(true)
  .mode('chat')
  .name(agentDef.name || agentId)  // ← 使用 name，fallback 到 agentId
  .agentId(agentId)  // ← 添加 agentId 方法设置 ID
  .sessionMode('memory')
  .maxTurns(1);

// 如果有 description，也设置
if (agentDef.description) {
  builder.description(agentDef.description);
}
```

**步骤 3: 在 BaseAgentBuilder 中添加字段**

**文件**: `src/main/agent/runtime/BaseAgentBuilder.ts`

```typescript
export abstract class BaseAgentBuilder {
  protected _name = 'agent';
  protected _agentId?: string;      // ← 添加
  protected _description?: string;  // ← 添加
  protected _mode: AgentMode = 'agent';
  // ...

  agentId(id: string): this {
    this._agentId = id;
    return this;
  }

  description(text: string): this {
    this._description = text;
    return this;
  }

  getAgentId(): string | undefined {
    return this._agentId;
  }

  getDescription(): string | undefined {
    return this._description;
  }
}
```

**步骤 4: 更新 ContextSnapshot 写入逻辑**

**文件**: `src/main/agent/runtime/ContextSnapshot.ts`

```typescript
const snapshot: ContextSnapshot = {
  timestamp: new Date().toISOString(),
  sessionId: options.sessionId || 'unknown',
  runtime: runtimeType,
  config: {
    agentId: options.agentId,        // ← 添加
    name: options.name,
    description: options.description, // ← 添加
    model: options.model || 'unknown',
    instructions: options.instructions,
    // ...
  },
  // ...
};
```

**步骤 5: 更新 AgentRuntimeOptions 类型**

**文件**: `src/main/agent/runtime/types.ts`

```typescript
export interface AgentRuntimeOptions {
  /** Agent ID（唯一标识）*/
  agentId?: string;
  /** Agent 名称 */
  name: string;
  /** Agent 描述 */
  description?: string;
  // ...
}
```

---

## 影响范围

### 受影响的功能
1. Context Snapshot 调试和分析
2. Agent 执行日志的可读性
3. 未来可能的 Agent 信息展示功能

### 不受影响的功能
1. Agent 正常执行（功能性无影响）
2. 前端展示（前端使用的是 Thread 和 Agent 定义，不依赖 context.jsonl）

## 优先级
**中等优先级**（问题 2 待修复）

- 问题 1 和 3 已修复
- 问题 2 是数据完整性和可维护性问题，不影响核心功能，但影响调试体验和未来扩展性

## 相关文件
- `src/main/agent/runtime/BaseAgentBuilder.ts`
- `src/main/agent/runtime/ContextSnapshot.ts`
- `src/main/agent/runtime/types.ts`
- `src/main/agent/extension/ExtensionApi.ts`
- `src/main/agent/AgentEnvInjector.ts`
- `src/main/agent/AgentEnv.ts`

## 相关文档
- [AppendInstructions 内容说明](../architecture/append-instructions-content.md)
- [核心 Skills 自动注入机制](../architecture/core-skills-injection.md)

## 测试建议

修复后应验证：
1. 当 `instructions` 为空字符串时，context.jsonl 记录的值
2. 当 `instructions` 为非空时，context.jsonl 记录的值
3. context.jsonl 中是否正确记录 `agentId`, `name`, `description`
4. 不同 runtime（OpenAI/PiMono）是否都正确记录

---

### 问题 3: 核心 Skills 自动注入未说明 ✅ **已修复**

> **修复日期**: 2026-04-22  
> **修复方式**: 移除强制注入机制，改为配置文件控制  
> **详情**: 参见 [Skills 注入机制重大变更](../architecture/skills-injection-change.md)

#### 现象（历史记录）

**Agent 配置文件**: `.home/agents/agent-mo04s0eg.json`
```json
{
  "skills": [],  // ← 空数组
  // ...
}
```

**Context Snapshot 记录**: `context.jsonl`（旧行为）
```json
{
  "config": {
    "skills": [
      {"name": "execution-protocol", "description": "..."},
      {"name": "self-reflection", "description": "..."},
      {"name": "eval-refine-loop", "description": "..."},
      {"name": "brain", "description": "..."},
      {"name": "dimension-architect", "description": "..."}
    ]
  }
}
```

**旧行为**: 即使 Agent 配置中 `skills` 为空数组，运行时仍然加载了 5 个核心 Skills。  
**新行为**: 完全由 Agent 配置决定，`skills: []` 则运行时不加载任何 Skill。

#### 问题代码位置

**文件**: `src/main/agent/skills/CoreSkills.ts:26-32`

```typescript
/**
 * 所有智能体必须常驻的核心技能名称
 */
export const CORE_SKILLS = [
  'execution-protocol',
  'self-reflection',
  'eval-refine-loop',
  'brain',
  'dimension-architect'
] as const;
```

**文件**: `src/main/agent/AgentEnvInjector.ts:137-147`

```typescript
// 8b. 注入核心技能到 builder（确保子 Agent 也拥有核心技能）
//     builder.skills() 是累加模式，不会覆盖已有 skills
const coreSkillDefs = CORE_SKILLS.map((name) => skillManager.getByName(name)).filter(
  (s): s is NonNullable<typeof s> => s !== null
);
if (coreSkillDefs.length > 0) {
  builder.skills(coreSkillDefs);
  log.info(
    `[EnvInjector] Injected ${coreSkillDefs.length} core skills: ${coreSkillDefs.map((s) => s.name).join(', ')}`
  );
}
```

#### 设计意图

这是一个**设计特性**，不是 Bug：

1. **核心 Skills 强制注入**: 无论 Agent 配置的 `skills` 数组是什么，运行时都会自动注入 5 个核心 Skills
2. **运行时注入**: 核心 Skills 在 `injectEnv()` 阶段注入到 Builder，不是存储在 Agent 定义文件中
3. **累加模式**: `builder.skills()` 是累加模式，不会覆盖用户配置的 Skills

#### 为什么这样设计

**文件**: `src/main/agent/skills/CoreSkills.ts:1-13` 注释

```
定义所有智能体（包括子智能体）必须常驻的核心技能

核心技能：
  - execution-protocol: 五步工作法执行协议，任务分解与目标管理
  - self-reflection:    自我评估与修复方法论，质量闭环保障
  - eval-refine-loop:   维度化评估与自动优化闭环
  - brain:              知识库搜索与经验沉淀
  - dimension-architect: 需求维度量化拆解
```

这些技能被认为是**所有 Agent 的基础能力**，必须强制存在。

#### 问题分析

1. **用户困惑**: 用户看到 Agent 配置中 `skills: []`，但运行时却加载了 5 个 Skills，不理解为什么
2. **文档缺失**: 没有明确的文档说明核心 Skills 会被自动注入
3. **UI 显示不一致**: Agent 配置页面显示 `skills: []`，但实际运行时有 5 个 Skills

#### 建议改进方案

**方案 1: 在 Agent 配置文件中明确标记核心 Skills**

修改 Agent 定义类型，添加 `coreSkills` 只读字段：

```typescript
export interface AgentDefinition {
  id: string;
  name: string;
  skills: string[];           // 用户自定义 Skills
  readonly coreSkills?: string[];  // 系统自动注入的核心 Skills（只读）
  // ...
}
```

在 Agent 存储时自动填充：
```typescript
// AgentStore.ts
async create(params: CreateAgentParams): Promise<AgentEntry> {
  const definition: AgentDefinition = {
    // ...
    skills: params.skills || [],
    coreSkills: [...CORE_SKILLS]  // 自动填充，标记为系统管理
  };
  // ...
}
```

**方案 2: 在 UI 中明确显示核心 Skills**

前端 Agent 编辑页面分两个区域：
- **核心 Skills (系统自动加载)**: 显示 5 个核心 Skills，不可编辑
- **自定义 Skills**: 用户可以添加/删除

**方案 3: 添加文档说明**

在以下位置添加说明：
1. Agent 创建 UI 的提示文本
2. `skills/CoreSkills.ts` 文件的顶部注释
3. README 或开发者文档

**方案 4: 提供关闭选项（不推荐）**

允许高级用户禁用核心 Skills：
```json
{
  "metadata": {
    "disableCoreSkills": true  // 高级选项，默认 false
  }
}
```

但这可能导致 Agent 功能不完整。

#### 优先级
~~**低优先级 - 文档/UX 改进**~~  
✅ **已提升为高优先级并修复**

用户明确反馈这是设计问题，要求移除强制注入。

#### 修复实施

**修复日期**: 2026-04-22

**修改的文件**:
- `src/main/agent/AgentEnvInjector.ts`
  - 移除强制注入核心 Skills 的代码
  - 改为从 Agent 配置读取 skills 数组
  - 只注入配置中指定的 Skills

**新行为**:
- `skills: []` → 运行时加载 0 个 Skills
- `skills: ["brain"]` → 运行时只加载 brain
- 完全由用户控制，不再有隐藏的自动注入

**相关文档**:
- [Skills 注入机制重大变更](../architecture/skills-injection-change.md) - 详细说明和迁移指南
- [核心 Skills 自动注入机制](../architecture/core-skills-injection.md) - 已标记为过时

**破坏性变更**:
- 现有 Agent 如果依赖核心 Skills 的自动注入，需要手动更新配置文件
- 建议为需要基础能力的 Agent 显式添加推荐 Skills

---

**创建时间**: 2026-04-22  
**发现人**: 用户反馈  
**记录人**: AI Assistant  
**修复时间**: 2026-04-22 (问题 1, 3)  
**状态**: 问题 1 和 3 已修复，问题 2 待修复
