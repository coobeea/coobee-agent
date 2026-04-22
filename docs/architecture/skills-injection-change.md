# Skills 注入机制重大变更

## 变更日期
2026-04-22

## 变更概述

移除了核心 Skills 的强制注入机制，改为**完全由 Agent 配置文件控制**。

## 旧机制（已废弃）

### 旧的行为

无论 Agent 配置文件中的 `skills` 数组是什么，系统都会**强制注入** 5 个核心 Skills：

```typescript
// src/main/agent/skills/CoreSkills.ts
export const CORE_SKILLS = [
  'execution-protocol',
  'self-reflection',
  'eval-refine-loop',
  'brain',
  'dimension-architect'
] as const;
```

**结果**：
- Agent 配置: `skills: []`
- 实际运行时: 5 个核心 Skills + 0 个用户 Skills = **5 个 Skills**

### 旧的代码

**文件**: `src/main/agent/AgentEnvInjector.ts`（已移除）

```typescript
// 8b. 注入核心技能到 builder（确保子 Agent 也拥有核心技能）
const coreSkillDefs = CORE_SKILLS.map((name) => skillManager.getByName(name)).filter(
  (s): s is NonNullable<typeof s> => s !== null
);
if (coreSkillDefs.length > 0) {
  builder.skills(coreSkillDefs);
  log.info(`[EnvInjector] Injected ${coreSkillDefs.length} core skills`);
}
```

## 新机制（当前实现）

### 新的行为

**完全由 Agent 配置文件决定**，不再有强制注入：

```json
// .home/agents/{agentId}.json
{
  "skills": []  // 空数组 → 不加载任何 Skill
}
```

```json
// .home/agents/{agentId}.json
{
  "skills": ["brain", "execution-protocol"]  // 只加载这两个
}
```

**结果**：
- Agent 配置: `skills: []` → 运行时: **0 个 Skills**
- Agent 配置: `skills: ["brain"]` → 运行时: **1 个 Skill**（brain）

### 新的代码

**文件**: `src/main/agent/AgentEnvInjector.ts:79-102`

```typescript
// 6. 从 Agent 定义中读取配置（dataDirectory、skills 等）
let agentDefinedSkills: string[] | undefined;
if (agentId) {
  try {
    const { AgentStore } = await import('./agents/AgentStore');
    const store = await AgentStore.getInstance();
    const agentDef = await store.get(agentId);
    if (agentDef) {
      // 读取 skills 配置（用于后续注入）
      agentDefinedSkills = agentDef.skills;
      log.debug(`[EnvInjector] Agent defined skills: ${agentDefinedSkills?.join(', ') || '(none)'}`);
    }
  } catch (error) {
    log.warn(`[EnvInjector] Failed to load agent definition for ${agentId}:`, error);
  }
}

// ...

// 8b. 根据 Agent 配置注入 Skills（不再强制注入核心 Skills）
if (agentDefinedSkills && agentDefinedSkills.length > 0) {
  const skillDefs = agentDefinedSkills
    .map((name) => skillManager.getByName(name))
    .filter((s): s is NonNullable<typeof s> => s !== null);
  
  if (skillDefs.length > 0) {
    builder.skills(skillDefs);
    log.info(`[EnvInjector] Injected ${skillDefs.length} agent skills: ${skillDefs.map((s) => s.name).join(', ')}`);
  }
  
  // 警告：如果配置的 skill 找不到
  const notFound = agentDefinedSkills.filter(
    (name) => !skillDefs.find((s) => s.name === name)
  );
  if (notFound.length > 0) {
    log.warn(`[EnvInjector] Skills not found: ${notFound.join(', ')}`);
  }
} else {
  log.debug(`[EnvInjector] No skills configured for agent ${agentId || '(unknown)'}`);
}
```

## 变更原因

### 用户反馈

用户认为强制注入核心 Skills 的设计不合理：
1. Agent 配置中 `skills: []` 是空的，但实际运行时有 5 个 Skills
2. 用户无法控制是否加载这些 Skills
3. 配置文件与实际行为不一致，造成困惑

### 设计哲学调整

**旧理念**: 核心 Skills 是所有 Agent 的"必备能力"，应该强制注入

**新理念**: 
- 用户对 Agent 行为有完全控制权
- 配置文件应该真实反映运行时行为
- Skills 是可选增强能力，不是必须的基础能力

## 影响分析

### 破坏性变更

✅ **是破坏性变更**

如果用户依赖核心 Skills 的自动注入（配置 `skills: []` 但期望有核心 Skills），升级后将失去这些能力。

### 迁移指南

**现有 Agent 需要手动更新配置**：

```bash
# 方案 1: 更新 Agent 配置文件
# 如果之前依赖核心 Skills，现在需要显式添加：

# 编辑 .home/agents/{agentId}.json
{
  "skills": [
    "execution-protocol",
    "self-reflection",
    "eval-refine-loop",
    "brain",
    "dimension-architect"
  ]
}
```

```bash
# 方案 2: 使用 API/UI 更新
# 在 Agent 编辑页面，添加需要的 Skills
```

### 受影响的功能

#### 可能失效的功能（如果 Agent 配置 skills 为空）

1. **execution-protocol**: 五步工作法、任务分解
2. **self-reflection**: 自我评估与修复
3. **eval-refine-loop**: 输出质量评估与优化
4. **brain**: 知识库搜索与经验复用
5. **dimension-architect**: 需求维度量化

#### 不受影响的功能

1. Agent 基本执行（工具调用、文本输出）
2. 用户自定义 Skills（配置中明确指定的）
3. Extension 系统注入的 Skills

## 优势

### 用户体验改进

1. ✅ **配置即所见**: Agent 配置文件真实反映运行时行为
2. ✅ **完全控制**: 用户决定加载哪些 Skills
3. ✅ **轻量化**: 可以创建不带任何 Skill 的轻量级 Agent
4. ✅ **更清晰**: 不再有"隐藏的"自动注入

### 系统设计改进

1. ✅ **可预测性**: 运行时行为完全由配置决定
2. ✅ **可测试性**: 更容易测试不同 Skills 组合
3. ✅ **灵活性**: 支持"无 Skill"的纯对话 Agent

## 风险和注意事项

### 风险

1. **现有 Agent 可能失去能力**: 需要手动迁移配置
2. **用户可能不知道推荐 Skills**: 需要 UI 提示
3. **子 Agent 创建**: 动态创建子 Agent 时需要显式指定 skills

### 缓解措施

1. **UI 推荐**: 在 Agent 创建/编辑页面，提示推荐的 Skills
2. **文档完善**: 说明各个核心 Skill 的作用
3. **迁移脚本**: 提供自动迁移工具（可选）
4. **模板 Agent**: 提供预配置了推荐 Skills 的 Agent 模板

## CORE_SKILLS 常量的新用途

虽然不再强制注入，但 `CORE_SKILLS` 常量仍然保留，用于：

1. **UI 推荐**: 前端可以读取这个列表，提示用户"推荐的 Skills"
2. **文档说明**: 说明系统推荐的基础 Skills
3. **快速配置**: 提供"使用推荐 Skills"按钮，一键添加核心 Skills
4. **测试基准**: 测试文件仍然使用这个常量

**建议**: 将 `CORE_SKILLS` 重命名为 `RECOMMENDED_SKILLS`，更准确反映其新用途。

## 实施步骤

### 已完成

1. ✅ 移除强制注入逻辑
2. ✅ 改为从 Agent 配置读取
3. ✅ 移除 CORE_SKILLS 导入
4. ✅ 更新注释说明
5. ✅ TypeScript 编译验证通过

### 待完成

1. ⏳ 更新 UI，添加推荐 Skills 提示
2. ⏳ 创建迁移脚本（可选）
3. ⏳ 更新用户文档
4. ⏳ 考虑重命名 CORE_SKILLS → RECOMMENDED_SKILLS

## 测试建议

### 测试场景

1. **空 Skills 配置**
   ```json
   { "skills": [] }
   ```
   预期: 运行时不加载任何 Skill

2. **部分 Skills 配置**
   ```json
   { "skills": ["brain"] }
   ```
   预期: 运行时只加载 brain

3. **全部核心 Skills**
   ```json
   {
     "skills": [
       "execution-protocol",
       "self-reflection",
       "eval-refine-loop",
       "brain",
       "dimension-architect"
     ]
   }
   ```
   预期: 运行时加载全部 5 个

4. **不存在的 Skill**
   ```json
   { "skills": ["non-existent-skill"] }
   ```
   预期: 日志警告，运行时不加载

### 验证方法

**方法 1: 查看 context.jsonl**
```bash
cat .home/workspaces/{sessionId}/context.jsonl | jq '.config.skills'
```

**方法 2: 查看日志**
```
[EnvInjector] Injected N agent skills: skill1, skill2, ...
```

**方法 3: 在运行时使用 skill_list 工具**
```
用户: 列出所有可用的 Skills
AI: [显示实际加载的 Skills]
```

## 迁移检查清单

升级到新版本后，请检查：

- [ ] 所有 Agent 的 skills 配置是否正确
- [ ] 依赖核心 Skills 的 Agent 是否已添加相应 skills
- [ ] 测试 Agent 是否仍能正常工作
- [ ] context.jsonl 中的 skills 列表是否符合预期

## 相关文件

### 修改的文件
- `src/main/agent/AgentEnvInjector.ts` - 移除强制注入，改为读取配置

### 保留的文件（供参考）
- `src/main/agent/skills/CoreSkills.ts` - CORE_SKILLS 常量保留，供 UI 推荐使用
- `src/main/agent/skills/__tests__/CoreSkills.test.ts` - 测试文件保留

### 需要更新的文件（未来）
- 前端 Agent 编辑页面 - 添加推荐 Skills 提示
- 用户文档 - 说明推荐的基础 Skills

## 相关文档

- [核心 Skills 自动注入机制](./core-skills-injection.md) - 旧机制的详细说明（已过时）
- [Context Snapshot Agent 信息问题](../issues/context-snapshot-agent-info-issues.md) - 相关问题

## 后续建议

### 1. UI 改进

在 Agent 创建/编辑页面添加：

```vue
<!-- Agent 编辑页面 -->
<div class="skills-section">
  <label>Skills (可选)</label>
  
  <!-- 推荐 Skills -->
  <div class="recommended-skills">
    <span>💡 推荐的基础 Skills:</span>
    <button @click="addRecommendedSkills">一键添加推荐 Skills</button>
  </div>
  
  <!-- Skills 列表 -->
  <div class="skills-list">
    <skill-item v-for="skill in skills" :key="skill" />
  </div>
</div>
```

### 2. 文档更新

在用户文档中添加：

**推荐的基础 Skills**

如果你想要 Agent 具备以下能力，建议添加对应的 Skill：

| Skill | 能力 | 推荐场景 |
|-------|------|---------|
| execution-protocol | 任务分解、五步工作法 | 复杂任务执行 |
| self-reflection | 自我评估与修复 | 需要质量保证 |
| eval-refine-loop | 输出质量评估 | 内容生成、优化 |
| brain | 知识库复用 | 需要记忆和学习 |
| dimension-architect | 需求量化分析 | 复杂需求分析 |

**纯对话 Agent**: 如果只需要简单对话，可以不添加任何 Skill（`skills: []`）。

### 3. 迁移工具（可选）

创建一个脚本，自动为所有现有 Agent 添加核心 Skills：

```bash
# scripts/migrate-add-core-skills.sh
#!/bin/bash
# 为所有 Agent 自动添加核心 Skills

for agent_file in .home/agents/*.json; do
  # 使用 jq 添加核心 skills
  jq '.skills += ["execution-protocol","self-reflection","eval-refine-loop","brain","dimension-architect"] | .skills |= unique' \
    "$agent_file" > "$agent_file.tmp"
  mv "$agent_file.tmp" "$agent_file"
done
```

## 总结

### 变更内容

| 方面 | 旧机制 | 新机制 |
|------|--------|--------|
| Skills 来源 | 强制注入 CORE_SKILLS | Agent 配置文件 |
| 用户控制 | ❌ 无法禁用 | ✅ 完全控制 |
| 配置一致性 | ❌ 配置 ≠ 实际 | ✅ 配置 = 实际 |
| 空数组行为 | 5 个核心 Skills | 0 个 Skills |

### 迁移要求

- **必须**: 检查并更新所有 Agent 的 skills 配置
- **推荐**: 为需要基础能力的 Agent 添加核心 Skills
- **可选**: 使用迁移脚本批量更新

### 优先级

🔴 **高优先级**

这是破坏性变更，需要：
1. 通知所有用户
2. 提供迁移指南
3. 更新文档和 UI

---

**变更类型**: 破坏性变更  
**影响范围**: 所有使用 Agent 的功能  
**迁移难度**: 中等（需要手动更新配置）  
**状态**: ✅ 已实施
