# Agent Executor P0 问题修复 - 待办事项

> 创建时间：2026-04-22
> 关联分支：待创建

## 状态说明

- [ ] 待处理
- [x] 已完成
- [-] 已取消

---

## 待办事项

### 1. P0-1: 修复 builderProjectDir 编译错误

- **描述**：移除 `AgentEnvInjector.ts` 中未定义的 `builderProjectDir` 变量，统一使用 `workspace`
- **验收标准**：
  - [x] `pnpm typecheck:node` 通过，无编译错误
  - [x] 第 211 行改为 `const effectiveCwd = workspace;`
  - [x] 第 227 行改为 `const effectiveCwdShared = workspace;`（改为 `builder.workspaceRoot(workspace);`）
  - [x] 增加注释说明当前不区分 workspace 和 projectDir
  - [x] 增加断言检查 workspace 非空
  - [x] 顺带修复了 `AgentEnv.ts` 中未使用的 `path` 导入
  - [ ] 现有测试全部通过（待验证）
- **状态**：[x] 已完成

---

### 2. P0-1: 验证修复后的行为

- **描述**：验证移除 `builderProjectDir` 后，Agent 执行和工具调用正常
- **验收标准**：
  - [ ] 运行 `pnpm test` 全部通过
  - [ ] 手动测试 chat 模式的 Agent 执行
  - [ ] 手动测试 agent 模式的 Agent 执行
  - [ ] 手动测试工具调用（read、write、exec）
  - [ ] 验证工具执行的 cwd 正确指向 workspace
- **状态**：[ ] 待处理

---

### 3. P0-2: 读取 Thread 和 Agent 数据

- **描述**：在 `ThreadWaker.submitResumeMessage()` 中增加 Thread 和 Agent 读取逻辑
- **验收标准**：
  - [x] 使用 `ThreadStore.getInstance()` 读取 Thread
  - [x] 使用 `AgentStore.getInstance()` 读取 Agent
  - [x] 增加空值检查：Thread 不存在时记录错误并返回
  - [x] 增加空值检查：Agent 不存在时记录错误并返回
  - [x] 使用 try-catch 包裹，捕获异常并记录日志（已有）
- **状态**：[x] 已完成

---

### 4. P0-2: 配置 Builder

- **描述**：参考 `ChatRoutes.sendMessage()`，配置完整的 Builder
- **验收标准**：
  - [x] 调用 `builder.sessionMode('file')`
  - [x] 调用 `builder.name(agent.id)`
  - [x] 调用 `agentExecutor.applyProviderConfig(builder, { modelOverride, sessionId, agentId })`
  - [x] 如果 `agent.instructions !== undefined`，调用 `builder.instructions(agent.instructions)`
  - [x] 增加日志输出，记录配置信息（threadId、agentId、model、hasInstructions）
- **状态**：[x] 已完成

---

### 5. P0-2: 增加 TODO 注释

- **描述**：在代码中增加注释，说明这是临时方案，需要在 P1 阶段重构
- **验收标准**：
  - [x] 增加 IMPORTANT 注释：Builder 配置逻辑应与 ChatRoutes 保持一致
  - [x] 增加 TODO 注释：在 P1 阶段抽取 ThreadExecutionFactory 消除重复代码
  - [x] 在代码中标注参考来源：`// Reference: ChatRoutes.sendMessage():170-181`
- **状态**：[x] 已完成

---

### 6. P0-2: 写集成测试

- **描述**：写一个集成测试，验证恢复路径和正常路径的行为一致
- **验收标准**：
  - [ ] 创建测试文件 `src/main/agent/threads/__tests__/ThreadWaker.integration.test.ts`
  - [ ] 测试场景 1：恢复路径能正确加载 Agent 配置
  - [ ] 测试场景 2：恢复路径设置了 `sessionMode('file')`
  - [ ] 测试场景 3：恢复路径的 model 和 instructions 与 Agent 定义一致
  - [ ] 测试场景 4：恢复后的会话能正确持久化
  - [ ] 所有测试通过
- **状态**：[ ] 待处理

---

### 7. 手动验证恢复场景

- **描述**：在开发环境手动测试 Thread 恢复功能
- **验收标准**：
  - [ ] 创建一个 Thread，发送几条消息
  - [ ] 重启应用
  - [ ] 恢复 Thread，发送新消息
  - [ ] 验证恢复后的对话能继续（模型、指令、上下文正确）
  - [ ] 验证恢复后的会话历史完整（history.jsonl 有记录）
  - [ ] 验证恢复后的工具调用正常
- **状态**：[ ] 待处理

---

### 8. 更新文档

- **描述**：更新相关文档，说明修复内容
- **验收标准**：
  - [ ] 在 `agent-module-review.md` 中标记 P0-1 和 P0-2 为"已修复"
  - [ ] 在 `agent-execution-flow.md` 中更新恢复路径的描述（如果有）
  - [ ] 在 CHANGELOG 或 commit message 中说明修复内容
- **状态**：[ ] 待处理

---

### 9. 代码审查和提交

- **描述**：代码审查，确保修复质量
- **验收标准**：
  - [ ] 运行 `pnpm lint` 无警告
  - [ ] 运行 `pnpm typecheck` 通过
  - [ ] 运行 `pnpm test` 全部通过
  - [ ] Git diff 检查，确保只修改了必要的文件
  - [ ] Commit message 清晰描述修复内容
  - [ ] 提交代码到分支
- **状态**：[ ] 待处理

---

## 执行顺序

建议按以下顺序执行：

1. ✅ **先修复 P0-1**（任务 1-2）：风险最低，立即见效
2. ✅ **再修复 P0-2**（任务 3-5）：依赖 P0-1 的稳定性
3. ✅ **增加测试覆盖**（任务 6-7）：确保修复质量
4. ✅ **收尾工作**（任务 8-9）：文档和代码审查

每完成一个任务，立即更新本文件和 `05-PROGRESS.md`。
