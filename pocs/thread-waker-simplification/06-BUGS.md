# ThreadWaker 过度设计简化 - 问题跟踪

> 创建时间：2026-04-28

## 当前问题

暂无阻塞问题。

---

## 问题记录

### B001：POC 对接入位置的建议过宽

- **现象**：方案中写“main.ts 或 Gateway 初始化处”均可接入。
- **判断**：不建议放 Gateway。恢复会触发 Agent 执行，应该等 Agent 系统完成工具注册、Extension 初始化和 stream consumers 初始化。
- **处理**：已接入 `ReadyAgentSystemHook` 末尾。
- **状态**：已解决

### B002：POC 对 ThreadExecutor 导入路径的描述需要按当前代码修正

- **现象**：需求中提到 `threadExecutor` 实际定义在 `ThreadExecutor.ts`，不是 `execution/index.ts`。
- **判断**：当前代码确实存在 `src/main/agent/ThreadExecutor.ts`，`ThreadWaker` 应直接导入该文件对应模块。
- **处理**：`ThreadWaker.ts` 使用 `import { threadExecutor } from '../ThreadExecutor'`。
- **状态**：已解决

### B003：全量 node typecheck 受既有 runtime 类型问题阻塞

- **现象**：`pnpm run typecheck:node` 失败。
- **判断**：错误集中在 `runtime/__tests__/AbstractAgentRuntime.test.ts`、`runtime/__tests__/AgentExecutor.test.ts`、`runtime/__tests__/RuntimeBuilderFactory.test.ts` 和 `runtime/services/CompressionService.ts`，与本次 ThreadWaker 简化无关。
- **处理**：本次相关测试和 ESLint 已通过；全量 typecheck 作为既有问题记录，不阻塞本项。
- **状态**：非本项阻塞

### B004：`tool-pending` 持久状态被删除后需同步恢复白名单

- **现象**：原方案恢复 `running/tool-pending`，但后续决定删除 `tool-pending`。
- **判断**：工具调用阶段没有独立持久化语义，应归入 `running`；恢复也只需要判断 `running`。
- **处理**：已同步 `ThreadWaker`、测试、前端运行中判断和相关文档。
- **状态**：已解决
