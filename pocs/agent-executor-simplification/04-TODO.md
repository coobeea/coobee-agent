# Agent Executor 简化调用 - TODO

> 创建时间：2026-04-28

### 1. 新增 ThreadExecutionFactory 收敛 Thread 调用装配

- **目标**：让外部调用方只传 `threadId + message`，不需要手动查 Thread/Agent 或组装执行请求。
- **涉及范围**：`src/main/agent/execution/ThreadExecutionFactory.ts`、`AgentExecutor.ts`
- **具体动作**：
  - 新增 `createRequest(params)` 方法。
  - 内部读取 `ThreadStore` 和 `AgentStore`。
  - 输出标准 `AgentExecuteRequest`。
  - `streamThread` 和 `submitThread` 改为调用 factory。
- **验收标准**：
  - [ ] 调用方 API 不变。
  - [ ] Thread/Agent 装配逻辑不再散落在 `AgentExecutor`。
- **状态**：[x]

### 2. 新增 SessionRunRegistry 收敛 busy、abort 和 runStatus

- **目标**：把运行状态从 `AgentExecutor` 中拆出，形成可复用的小状态机。
- **涉及范围**：`src/main/agent/execution/SessionRunRegistry.ts`、`AgentExecutor.ts`
- **具体动作**：
  - 提供 `start()`、`finish()`、`abort()`、`getStatus()`、`getActiveSessions()`。
  - 提供 `updateRunStatus()`，内部对同一状态去重。
  - 保留子 Agent sessionId 含 `:` 时不写 Thread 状态的规则。
- **验收标准**：
  - [ ] busy 逻辑保持兼容。
  - [ ] abort 逻辑保持兼容。
  - [ ] Thread runStatus 更新集中到 registry。
- **状态**：[x]

### 3. 更新测试覆盖新内部边界

- **目标**：保证外部调用方式不变，新服务行为可验证。
- **涉及范围**：AgentExecutor 相关测试、新增 execution 测试。
- **具体动作**：
  - 补充 `ThreadExecutionFactory` 不存在 Thread 的测试。
  - 补充 `SessionRunRegistry` busy/finish/status 基础测试。
  - 运行相关 vitest。
- **验收标准**：
  - [ ] 相关测试通过。
- **状态**：[x]

### 4. 新增 ThreadExecutor 作为 Thread 专用对外门面

- **目标**：从 `AgentExecutor` 中移除 Thread 便捷方法，让 `AgentExecutor` 只处理标准执行请求，Thread 场景由专用门面承接。
- **涉及范围**：
  - `src/main/agent/execution/ThreadExecutor.ts`
  - `src/main/agent/AgentExecutor.ts`
  - `src/main/routes/ChatRoutes.ts`
  - `src/main/rpc/ChatMethods.ts`
  - `src/main/agent/threads/ThreadWaker.ts`
- **具体动作**：
  - 新增 `threadExecutor.stream(threadId, message)` 和 `threadExecutor.submit(threadId, message)`。
  - 将 ChatRoutes、ChatMethods、ThreadWaker 改为使用 `threadExecutor`。
  - 删除 `AgentExecutor.streamThread()` 和 `AgentExecutor.submitThread()`。
  - 补充 `ThreadExecutor` 单元测试，并更新相关集成测试 mock。
- **验收标准**：
  - [x] 外部 Thread 调用只传 `threadId + message`。
  - [x] `AgentExecutor` 不再暴露 Thread 专用方法。
  - [x] 相关测试通过。
- **状态**：[x]
