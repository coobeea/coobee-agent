# context.jsonl 工具参数 Schema 缺失 - TODO

> 创建时间：2026-04-28

## 待办任务

- [ ] **T1**: `AbstractAgentRuntime.writeSnapshot()` — `config.tools` 添加 parameters（Zod → JSON Schema）
  - 文件：`src/main/agent/runtime/AbstractAgentRuntime.ts:170-172`
  - 引入 `z.toJSONSchema()` 转换

- [ ] **T2**: `PiMonoAgentRuntime.buildRequestPreview()` — `rawApiRequest.tools` 添加 parameters
  - 文件：`src/main/agent/runtime/pimono/PiMonoAgentRuntime.ts:513-520`
  - 复用或内联 `stripSchemaRef`

- [ ] **T3**: 检查 `ClaudeAgentRuntime.buildRequestPreview()` 是否有同样问题
  - 文件：`src/main/agent/runtime/claude/ClaudeAgentRuntime.ts`

- [ ] **T4**: 考虑将 `stripSchemaRef` 提取为共享工具函数
  - 位置：`src/main/agent/runtime/shared/zod-utils.ts`
  - 或者在各自文件中内联

- [ ] **T5**: 验证修改后的 context.jsonl 格式正确
  - 执行一次 Agent 调用
  - 检查 `.home/workspaces/{sessionId}/context.jsonl` 中的 `config.tools` 和 `rawApiRequest.tools`
