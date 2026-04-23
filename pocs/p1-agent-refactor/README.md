# Agent 模块 P1 阶段重构 POC

> 创建时间：2026-04-22
> 优先级：P1（建议尽快收敛）
> 方案：上策（完整重构）
> 预计工作量：3-5 天

## 概述

P1 阶段重构旨在**拆分职责、消除重叠、统一抽象**，解决以下核心问题：

1. ❌ Agent / Thread / Env 三层目录语义漂移
2. ❌ 流式事件链路存在两套抽象
3. ❌ 两套 Runtime 的事件模型不一致
4. ❌ Prompt 拼装链过散、过重
5. ❌ 生命周期依赖只写在注释里
6. ❌ ThreadWaker 代码重复（P0 遗留）

## 解决方案

### 核心改动

| 改动 | 说明 | 解决问题 |
|------|------|---------|
| 新增 `AgentContextResolver` | 统一路径和上下文解析 | 问题 1, 6 |
| 新增 `ThreadExecutionFactory` | 统一 Builder 配置 | 问题 6 |
| 新增 `PromptAssemblyService` | 统一 Prompt 拼装（可选） | 问题 4 |
| 清理 `AgentEventWriter` | 改为 EventBus 适配层 | 问题 2 |
| 统一 Runtime 事件模型 | OpenAI Runtime 改用 yield | 问题 3 |
| 修正生命周期 priority | 代码和注释保持一致 | 问题 5 |

### 架构改进

**重构前**：
```
AgentStore.create() ─────┐
ThreadStore.create() ────┼─→ 各自维护路径逻辑
AgentEnvInjector ────────┘

ChatRoutes.sendMessage() ─┐
ThreadWaker.resume() ─────┼─→ 重复的 Builder 配置（约 30 行）
                          ┘

OpenAI Runtime ──────┐
                     ├─→ 两条事件广播路径
Executor ────────────┘
```

**重构后**：
```
AgentContextResolver ──→ 统一路径解析
      ↓
ThreadExecutionFactory ──→ 统一 Builder 配置
      ↓
AgentStore / ThreadStore ──→ 只存定义，不负责路径
      ↓
ChatRoutes / ThreadWaker ──→ 调用 Factory，无重复代码

Runtime ──yield→ Executor ──→ EventBus ──→ Consumers
                                (唯一事件链路)
```

## 文档结构

| 文件 | 说明 |
|------|------|
| `01-需求分析.md` | 问题列表、背景、目标、约束条件 |
| `02-方案设计.md` | 上中下三策对比，用户选择上策 |
| `03-反思优化.md` | 边界检查、安全评估、性能分析、最终调整 |
| `04-TODO.md` | 16 个任务清单，分 5 个阶段 |
| `05-PROGRESS.md` | 进度跟踪，实时更新 |
| `06-BUGS.md` | 问题记录，遇到问题时更新 |

## 任务清单

### 阶段 1：基础模块（0.5 + 0.5 + 0.25 = 1.25 天）

- [ ] 1.1 实现 `AgentContextResolver`
- [ ] 1.2 实现 `ThreadExecutionFactory`
- [ ] 1.3 修正生命周期 priority

### 阶段 2：集成改动（0.25 × 5 = 1.25 天）

- [ ] 2.1 重构 `AgentStore`
- [ ] 2.2 重构 `ThreadStore`
- [ ] 2.3 重构 `AgentEnvInjector`
- [ ] 2.4 重构 `ChatRoutes`
- [ ] 2.5 重构 `ThreadWaker`

### 阶段 3：事件统一（0.5 + 1 = 1.5 天）

- [ ] 3.1 清理 `AgentEventWriter`
- [ ] 3.2 统一 OpenAI Runtime 事件模型

### 阶段 4：Prompt 优化（可选，1 + 0.5 + 0.5 = 2 天）

- [ ] 4.1 实现 `PromptAssemblyService`
- [ ] 4.2 集成 `PromptAssemblyService`
- [ ] 4.3 修复 PiMono 双重注入

### 阶段 5：文档和测试（0.5 + 0.5 + 0.25 = 1.25 天）

- [ ] 5.1 更新架构文档
- [ ] 5.2 完整回归测试
- [ ] 5.3 代码审查和提交

**总计**：3-5 天（不含阶段 4 为 3 天，含阶段 4 为 5 天）

## 预期收益

### 架构层面

- ✅ **职责清晰**：路径解析、Builder 配置、Prompt 拼装各司其职
- ✅ **减少重复**：ChatRoutes 和 ThreadWaker 共享 Factory，删除约 30 行重复代码
- ✅ **统一抽象**：事件链路唯一，文档和代码一致
- ✅ **易于测试**：单个模块复杂度降低，单元测试更容易编写

### 维护层面

- ✅ `AgentEnvInjector` 从 300+ 行缩减为 150 行
- ✅ 路径逻辑统一，默认值改动只需修改一处
- ✅ 事件链路清晰，调试更容易
- ✅ 新人上手更快，文档和代码保持同步

### 性能层面

- ✅ `AgentContextResolver` 增加缓存，减少重复查询
- ✅ Prompt 拼装可追溯，便于优化 token 成本
- ➡️ 其他改动对性能无影响或略有提升

## 风险评估

| 风险 | 严重程度 | 应对措施 |
|------|---------|---------|
| OpenAI Runtime 事件不兼容 | 中 | 增加集成测试，必要时回退 |
| 回归测试失败 | 中 | 分模块提交，逐步合并 |
| 文档更新不及时 | 低 | 每个改动都同步更新文档 |
| 改动范围过大 | 中 | 按阶段划分，可分多个 PR |

## 成功标准

- ✅ 所有 P1 问题已解决
- ✅ 所有测试通过，无新增回归问题
- ✅ 文档已更新，代码和文档一致
- ✅ 代码复杂度降低，单个模块职责清晰
- ✅ PR 已创建，等待 review

## 下一步

开始执行 **阶段 1：基础模块实现**

1. 任务 1.1：实现 `AgentContextResolver`
2. 任务 1.2：实现 `ThreadExecutionFactory`
3. 任务 1.3：修正生命周期 priority

详细任务清单见 `04-TODO.md`。
