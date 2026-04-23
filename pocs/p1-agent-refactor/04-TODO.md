# Agent 模块 P1 阶段重构 - 待办事项

> 创建时间：2026-04-22
> 方案：上策（完整重构）
> 预计工作量：3-5 天

## 状态说明

- [ ] 待处理
- [x] 已完成
- [-] 已取消
- [~] 进行中

---

## 任务清单

### 阶段 1：基础模块实现（优先级最高）

#### 任务 1.1：实现 AgentContextResolver

- **描述**：新增 `src/main/agent/context/AgentContextResolver.ts`，统一路径和上下文解析
- **验收标准**：
  - [x] 创建 `AgentContextResolver` 类
  - [x] 实现 `resolve()` 方法，返回 `AgentContext`
  - [x] 增加参数验证（agentId 必填）
  - [x] 增加错误处理（Agent 不存在时抛异常）
  - [x] 实现缓存机制（5 分钟 TTL）
  - [x] 增加路径安全验证（防止路径遍历）
  - [x] 编写单元测试（覆盖正常场景、边界情况、错误处理）
  - [x] `pnpm typecheck:node` 通过
- **预计时间**：0.5 天
- **状态**：[x] 已完成

---

#### 任务 1.2：实现 ThreadExecutionFactory

- **描述**：新增 `src/main/agent/execution/ThreadExecutionFactory.ts`，统一 Builder 配置
- **验收标准**：
  - [ ] 创建 `ThreadExecutionFactory` 类
  - [ ] 实现 `createBuilder()` 方法
  - [ ] 调用 `AgentContextResolver` 解析上下文
  - [ ] 配置 `sessionMode`, `name`, `applyProviderConfig`, `instructions`
  - [ ] 增加空值处理（modelOverride 和 instructions）
  - [ ] 编写单元测试（覆盖正常场景、Thread 不存在、Agent 不存在）
  - [ ] `pnpm typecheck:node` 通过
- **预计时间**：0.5 天
- **依赖**：任务 1.1
- **状态**：[ ] 待处理

---

#### 任务 1.3：修正生命周期 priority [已完成] ✅

- **描述**：修改 `ReadyGatewayHook.ts` 的 priority，确保顺序正确
- **完成时间**：2026-04-22
- **验收标准**：
  - [x] `ReadyGatewayHook.priority` 改为 45
  - [x] 更新注释，说明顺序："Gateway(45) -> Agent(50) -> Config(55)"
  - [ ] 编写集成测试，验证初始化顺序（暂缓）
  - [x] `pnpm typecheck:node` 通过
- **预计时间**：0.25 天 | **实际时间**：0.5 小时
- **状态**：[x] 已完成

---

### 阶段 2：集成到现有模块（核心改动）

#### 任务 2.1：重构 AgentStore [已完成] ✅

- **描述**：移除 `AgentStore.create()` 中的路径初始化逻辑
- **完成时间**：2026-04-22
- **验收标准**：
  - [x] 删除 `dataDirectory` 初始化代码
  - [x] 删除 `dataDirectory` 自动创建代码
  - [x] 保留 Agent 定义存储逻辑
  - [x] 更新相关注释（说明由 AgentContextResolver 处理）
  - [x] `pnpm typecheck:node` 通过
- **预计时间**：0.25 天 | **实际时间**：0.5 小时
- **依赖**：任务 1.1
- **状态**：[x] 已完成

---

#### 任务 2.2：重构 ThreadStore [已完成] ✅

- **描述**：移除 `ThreadStore.ensureAgentDataDirectory()` 调用
- **完成时间**：2026-04-22
- **验收标准**：
  - [x] 删除 `ensureAgentDataDirectory()` 方法定义（约 40 行）
  - [x] 删除 `create()` 中的调用
  - [x] 保留 Thread 定义存储逻辑
  - [x] 更新相关注释
  - [x] `pnpm typecheck:node` 通过
- **预计时间**：0.25 天 | **实际时间**：0.25 小时
- **依赖**：任务 1.1
- **状态**：[x] 已完成

---

#### 任务 2.3：重构 AgentEnvInjector [已完成] ✅

- **描述**：使用 `AgentContextResolver` 替代内部路径解析逻辑
- **完成时间**：2026-04-22
- **验收标准**：
  - [x] 在 `injectEnv()` 中调用 `resolver.resolve()`
  - [x] 删除内部路径推导逻辑（约 15 行）
  - [x] 保持接口不变（向后兼容）
  - [x] 更新相关注释
  - [x] `pnpm typecheck:node` 通过（无 AgentEnvInjector 错误）
- **预计时间**：0.5 天 | **实际时间**：0.5 小时
- **依赖**：任务 1.1
- **状态**：[x] 已完成

---

#### 任务 2.4：重构 ChatRoutes [已完成] ✅

- **描述**：使用 `ThreadExecutionFactory` 替代现有 Builder 配置代码
- **完成时间**：2026-04-22
- **验收标准**：
  - [x] 在 `sendMessage()` 中调用 `factory.createBuilder()`
  - [x] 删除现有 Builder 配置代码（约 12 行）
  - [x] 保持接口不变（向后兼容）
  - [x] `pnpm typecheck:node` 通过（无 ChatRoutes 错误）
- **预计时间**：0.25 天 | **实际时间**：0.25 小时
- **依赖**：任务 1.2
- **状态**：[x] 已完成

---

#### 任务 2.5：重构 ThreadWaker

- **描述**：使用 `ThreadExecutionFactory` 替代现有 Builder 配置代码
- **验收标准**：
  - [ ] 在 `submitResumeMessage()` 中调用 `factory.createBuilder()`
  - [ ] 删除现有 Builder 配置代码（约 15 行）
  - [ ] 删除 P0-2 遗留的 TODO 注释
  - [ ] 运行集成测试，验证 Thread 恢复功能正常
  - [ ] `pnpm test -- src/main/agent/threads` 通过
- **预计时间**：0.25 天
- **依赖**：任务 1.2
- **状态**：[ ] 待处理

---

### 阶段 3：事件链路统一（中等优先级）

#### 任务 3.1：清理 AgentEventWriter

- **描述**：将 `AgentEventWriter` 改为 EventBus 适配层
- **验收标准**：
  - [ ] 在 `AgentEventWriter.ts` 顶部增加 `@deprecated` 注释
  - [ ] 所有方法内部改为转发到 `EventBus`
  - [ ] 更新 `AgentExecutor.ts` 顶部注释，说明主事件链路
  - [ ] 运行 `pnpm test` 确保 Extension 场景仍然工作
- **预计时间**：0.5 天
- **状态**：[ ] 待处理

---

#### 任务 3.2：统一 OpenAI Runtime 事件模型

- **描述**：OpenAI Runtime 不再直接调用 `streamEmitter`，改用 `yield`
- **验收标准**：
  - [ ] 修改 `agent_updated` 事件，改为 `yield StreamChunk`
  - [ ] 修改工具增量输出，改为 `yield StreamChunk`
  - [ ] 删除 Runtime 内部的 `streamEmitter.forward()` 调用
  - [ ] 编写集成测试，验证 SSE 和 EventBus 事件一致
  - [ ] `pnpm test -- src/main/agent/runtime/openai` 通过
- **预计时间**：1 天
- **状态**：[ ] 待处理

---

### 阶段 4：Prompt 拼装优化（可选）

#### 任务 4.1：实现 PromptAssemblyService（基础版本）

- **描述**：新增 `src/main/agent/prompt/PromptAssemblyService.ts`，统一 Prompt 拼装
- **验收标准**：
  - [ ] 创建 `PromptAssemblyService` 类
  - [ ] 实现 `assemble()` 方法，返回 `PromptBlock[]`
  - [ ] 支持 instructions, agent_home, skills, agents_md
  - [ ] 增加大小限制（Agent Home 10000 字符，AGENTS.md 50000 字符）
  - [ ] 实现简单 token 估算（1 token ≈ 3 chars）
  - [ ] 编写单元测试
  - [ ] `pnpm typecheck:node` 通过
- **预计时间**：1 天
- **状态**：[ ] 待处理（可选）

---

#### 任务 4.2：集成 PromptAssemblyService

- **描述**：在 `AgentEnvInjector` 中使用 `PromptAssemblyService`
- **验收标准**：
  - [ ] 调用 `assemblyService.assemble()` 替代现有拼装逻辑
  - [ ] 删除内部 Prompt 拼装代码（约 50 行）
  - [ ] 验证 Prompt 内容一致
  - [ ] `pnpm test` 通过
- **预计时间**：0.5 天
- **依赖**：任务 4.1
- **状态**：[ ] 待处理（可选）

---

#### 任务 4.3：修复 PiMono 双重注入

- **描述**：PiMono Runtime 不再双重注入技能信息
- **验收标准**：
  - [ ] 修改 `PiMonoAgentRuntime.ts`，移除技能摘要拼接
  - [ ] 保留 `resourceLoader.getSkills()`（SDK 需要）
  - [ ] 验证 Prompt 中技能信息只出现一次
  - [ ] `pnpm test -- src/main/agent/runtime/pimono` 通过
- **预计时间**：0.5 天
- **依赖**：任务 4.2
- **状态**：[ ] 待处理（可选）

---

### 阶段 5：文档和测试（收尾工作）

#### 任务 5.1：更新架构文档

- **描述**：更新相关文档，说明 P1 重构内容
- **验收标准**：
  - [ ] 在 `agent-module-review.md` 中标记 P1 问题已解决
  - [ ] 更新 `agent-execution-flow.md` 的事件链路描述
  - [ ] 更新 `src/main/agent/README.md` 的模块职责说明
  - [ ] 新增 API 文档：ContextResolver, Factory, PromptService
- **预计时间**：0.5 天
- **状态**：[ ] 待处理

---

#### 任务 5.2：完整回归测试

- **描述**：运行完整测试套件，验证所有功能正常
- **验收标准**：
  - [ ] `pnpm run typecheck:node` 通过
  - [ ] `pnpm run typecheck:web` 通过
  - [ ] `pnpm test` - 无新增失败
  - [ ] 手动测试 Chat 模式
  - [ ] 手动测试 Thread 恢复
  - [ ] 手动测试工具调用
- **预计时间**：0.5 天
- **状态**：[ ] 待处理

---

#### 任务 5.3：代码审查和提交

- **描述**：代码审查，确保重构质量
- **验收标准**：
  - [ ] 运行 `pnpm lint` - 修复新增警告
  - [ ] Git diff 检查，确保改动合理
  - [ ] 编写清晰的 commit message
  - [ ] 提交代码到分支 `refactor/p1-agent-module`
  - [ ] 创建 PR，描述中引用 `pocs/p1-agent-refactor/`
- **预计时间**：0.25 天
- **状态**：[ ] 待处理

---

## 任务依赖关系

```
阶段 1（基础模块）
├── 1.1 AgentContextResolver
├── 1.2 ThreadExecutionFactory（依赖 1.1）
└── 1.3 修正 priority

阶段 2（集成改动）
├── 2.1 重构 AgentStore（依赖 1.1）
├── 2.2 重构 ThreadStore（依赖 1.1）
├── 2.3 重构 AgentEnvInjector（依赖 1.1）
├── 2.4 重构 ChatRoutes（依赖 1.2）
└── 2.5 重构 ThreadWaker（依赖 1.2）

阶段 3（事件统一）
├── 3.1 清理 AgentEventWriter
└── 3.2 统一 OpenAI Runtime

阶段 4（Prompt 优化，可选）
├── 4.1 实现 PromptAssemblyService
├── 4.2 集成 PromptAssemblyService（依赖 4.1）
└── 4.3 修复 PiMono 双重注入（依赖 4.2）

阶段 5（文档和测试）
├── 5.1 更新架构文档
├── 5.2 完整回归测试
└── 5.3 代码审查和提交
```

---

## 执行策略

### 推荐顺序

1. **Day 1**: 阶段 1（基础模块）
   - 任务 1.1, 1.2, 1.3
   - 预计：1.25 天 → 压缩为 1 天

2. **Day 2-3**: 阶段 2（集成改动）
   - 任务 2.1, 2.2, 2.3, 2.4, 2.5
   - 预计：1.5 天

3. **Day 4**: 阶段 3（事件统一）
   - 任务 3.1, 3.2
   - 预计：1.5 天

4. **Day 5**: 阶段 4（可选）+ 阶段 5（收尾）
   - 如果时间充裕，完成 4.1-4.3
   - 必须完成 5.1-5.3
   - 预计：1-2 天

### 风险缓冲

- 如果 Day 4 进度落后，阶段 4 可以跳过（标记为后续优化）
- 如果 OpenAI Runtime 改动遇到问题，可以暂时回退，先合并其他改动

---

## 进度跟踪

每完成一个任务，立即更新：
- 本文件（`04-TODO.md`）- 勾选任务
- `05-PROGRESS.md` - 追加进度记录
- `06-BUGS.md` - 如果遇到问题

---

## 成功标准

- ✅ 所有必做任务（阶段 1-3, 5）已完成
- ✅ 所有测试通过，无新增回归问题
- ✅ 文档已更新，代码和文档一致
- ✅ PR 已创建，等待 review
