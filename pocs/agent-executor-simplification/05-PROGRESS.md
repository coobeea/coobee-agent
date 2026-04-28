# Agent Executor 简化调用 - PROGRESS

> 创建时间：2026-04-28

- 2026-04-28：初始化需求、方案、TODO，选定“先拆入口装配和运行状态”的中策。
- 2026-04-28：新增 `ThreadExecutionFactory`，`streamThread` 和 `submitThread` 已改为通过工厂生成标准执行请求。
- 2026-04-28：新增 `SessionRunRegistry`，`AgentExecutor` 的 busy、abort、active sessions、runStatus 更新已迁移到 registry。
- 2026-04-28：补充 execution 局部测试并回归 `AgentExecutor` 测试，相关测试通过。
- 2026-04-28：针对本次改动文件运行 ESLint，通过。`typecheck:node` 仍受仓库既有 runtime 测试/CompressionService 类型问题影响，未作为本次阻塞。
- 2026-04-28：按讨论新增 `ThreadExecutor` 门面，迁移 ChatRoutes、ChatMethods、ThreadWaker，`AgentExecutor` 已移除 `streamThread/submitThread`。
