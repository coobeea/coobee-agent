# 核心 Skills 自动注入机制

## 概述

系统设计了一套**核心 Skills 强制注入机制**，确保所有 Agent（包括子 Agent）都具备基础能力。

## 核心 Skills 列表

定义在 `src/main/agent/skills/CoreSkills.ts`:

```typescript
export const CORE_SKILLS = [
  'execution-protocol',    // 五步工作法执行协议
  'self-reflection',       // 自我评估与修复方法论
  'eval-refine-loop',      // 维度化评估与自动优化闭环
  'brain',                 // 知识库搜索与经验沉淀
  'dimension-architect'    // 需求维度量化拆解
] as const;
```

## 注入时机

### 1. 运行时注入（主要方式）

**位置**: `src/main/agent/AgentEnvInjector.ts:137-147`

**时机**: 每次 Agent 执行前，在 `injectEnv()` 阶段

**流程**:
```
AgentExecutor.execute()
    ↓
injectEnv(sessionId, builder)
    ↓
扫描 Skill 目录 → 创建 SkillManager
    ↓
获取核心 Skills 定义
    ↓
builder.skills(coreSkillDefs)  ← 注入到 Builder
    ↓
Runtime 构建时包含核心 Skills
```

**代码**:
```typescript
// 注入核心技能到 builder（确保子 Agent 也拥有核心技能）
const coreSkillDefs = CORE_SKILLS.map((name) => skillManager.getByName(name)).filter(
  (s): s is NonNullable<typeof s> => s !== null
);
if (coreSkillDefs.length > 0) {
  builder.skills(coreSkillDefs);
  log.info(`[EnvInjector] Injected ${coreSkillDefs.length} core skills`);
}
```

**特点**:
- ✅ **强制注入**: 无论 Agent 配置的 `skills` 是什么，都会注入
- ✅ **累加模式**: 不会覆盖用户配置的 Skills
- ✅ **每次执行**: 每次 Agent 执行都会重新注入
- ✅ **不持久化**: 不会修改 Agent 配置文件

### 2. Agent 定义合并（备用方式）

**位置**: `src/main/agent/skills/CoreSkills.ts:39-69`

**函数**: `ensureCoreSkills(skills: string[]): string[]`

**用途**: 在创建或更新 Agent 时，确保 skills 数组包含核心 Skills

**状态**: ❌ **目前未使用**

`AgentStore` 没有调用 `ensureCoreSkills()`，意味着 Agent 配置文件中的 `skills` 数组可以为空，核心 Skills 完全由运行时注入。

## 设计优缺点

### 优点

1. **统一保障**: 所有 Agent 都有基础能力，无需用户手动配置
2. **子 Agent 一致性**: 动态创建的子 Agent 自动获得核心 Skills
3. **灵活更新**: 修改核心 Skills 列表，所有 Agent 立即生效
4. **配置文件简洁**: Agent 配置不需要列出核心 Skills

### 缺点

1. **用户困惑**: Agent 配置 `skills: []`，但实际加载了 5 个 Skills
2. **不可见**: 用户无法从配置文件看到核心 Skills
3. **无法禁用**: 用户无法禁用不需要的核心 Skills（虽然这是有意设计）
4. **UI 不一致**: 前端显示的 Skills 列表与实际运行时不一致

## 与用户自定义 Skills 的关系

### Skills 优先级

1. **核心 Skills** (最高优先级) - 系统强制注入
2. **Extension 自动注入 Skills** (次优先级) - Extension 系统贡献
3. **用户自定义 Skills** (最低优先级) - 用户在 Agent 配置中添加

### 合并逻辑

```typescript
// 伪代码
最终 Skills = [
  ...核心 Skills (5个),
  ...Extension 注入 Skills (N个),
  ...用户配置 Skills (M个)
]
```

**去重**: 如果用户配置中已包含核心 Skill，不会重复添加

## Context Snapshot 记录

**文件**: `context.jsonl`

```json
{
  "config": {
    "skills": [
      {"name": "execution-protocol", "description": "..."},
      {"name": "self-reflection", "description": "..."},
      {"name": "eval-refine-loop", "description": "..."},
      {"name": "brain", "description": "..."},
      {"name": "dimension-architect", "description": "..."}
      // 如果用户有自定义 Skills，会追加在这里
    ]
  }
}
```

**特点**: Context Snapshot 记录的是**实际运行时的 Skills**（包含核心 Skills），而不是 Agent 配置文件中的 Skills。

## 调试和验证

### 查看实际加载的 Skills

**方法 1: 查看日志**
```
[EnvInjector] Injected 5 core skills: execution-protocol, self-reflection, eval-refine-loop, brain, dimension-architect
```

**方法 2: 查看 Context Snapshot**
```bash
cat .home/workspaces/{sessionId}/context.jsonl | jq '.config.skills'
```

**方法 3: 在 Agent 中使用 skill_list 工具**
```
用户: 列出所有可用的 Skills
AI: [调用 skill_list 工具，显示所有 Skills]
```

## 常见问题

### Q1: 为什么 Agent 配置的 skills 是空数组，但运行时有 5 个 Skills？

A: 这是设计特性。核心 Skills 在运行时自动注入，不需要在配置文件中显式列出。

### Q2: 如何禁用某个核心 Skill？

A: 目前不支持。核心 Skills 被认为是所有 Agent 的必备能力。如果确实需要，可以修改 `CORE_SKILLS` 常量，但不推荐。

### Q3: 我添加的自定义 Skill 会覆盖核心 Skills 吗？

A: 不会。`builder.skills()` 是累加模式，你的自定义 Skills 会追加到核心 Skills 之后。

### Q4: 子 Agent 也会自动获得核心 Skills 吗？

A: 是的。`injectEnv()` 对所有 Agent 生效，包括动态创建的子 Agent。

### Q5: 核心 Skills 列表会变化吗？

A: 可能。团队可能根据需要增减核心 Skills。修改 `CORE_SKILLS` 常量后，所有 Agent 立即生效。

## 未来改进方向

### 1. UI 层面明确显示

前端 Agent 编辑页面分区显示：
- **核心 Skills (系统自动加载)**: 只读显示
- **自定义 Skills**: 用户可编辑

### 2. Agent 配置中持久化

考虑在 Agent 定义中添加只读字段：
```json
{
  "skills": ["my-custom-skill"],
  "coreSkills": ["execution-protocol", "self-reflection", "..."]
}
```

### 3. 高级选项（谨慎）

为高级用户提供禁用核心 Skills 的开关：
```json
{
  "metadata": {
    "disableCoreSkills": true
  }
}
```

### 4. 文档完善

- 在 README 中说明核心 Skills 机制
- 在 Agent 创建 UI 中添加提示
- 在开发者文档中详细说明

## 相关文件

- `src/main/agent/skills/CoreSkills.ts` - 核心 Skills 定义
- `src/main/agent/AgentEnvInjector.ts` - 运行时注入逻辑
- `src/main/agent/skills/SkillManager.ts` - Skill 管理器
- `src/main/agent/runtime/types.ts` - SkillDefinition 类型定义

## 相关问题

- [Context Snapshot Agent 信息问题 - 问题3](../issues/context-snapshot-agent-info-issues.md#问题-3-核心-skills-自动注入未说明)

---

**文档版本**: 1.0  
**最后更新**: 2026-04-22  
**维护者**: AI Assistant
