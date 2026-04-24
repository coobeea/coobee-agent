# history.jsonl 结构重构 - 待办事项

> 创建时间：2026-04-24  
> 关联分支：feature/history-structure-refactor

## 状态说明

- [ ] 待处理
- [x] 已完成
- [-] 已取消

---

## 待办事项

### 1. 定义 v2 history 类型

**描述**：定义 `history.jsonl` 新格式的数据结构，只面向 v2。

**验收标准**：

- [x] 定义 `HistoryMessageV2`，包含 `version: 2`
- [x] 定义 `TurnRecord`，包含 `index/startTime/endTime/status/reasoning/content/toolCalls/usage`
- [x] 定义 `ToolCallRecord`，包含 `name/callId/arguments/result/status/startTime/endTime`
- [x] 定义 `UsageRecord`，包含 `inputTokens/outputTokens/totalTokens`
- [x] assistant 顶层包含 `content/usage/startTime/endTime/turns`
- [x] 不定义旧格式兼容类型

**状态**：[x] 已完成

---

### 2. 实现 run 级聚合

**描述**：将 `HistoryWriter` 从 turn 级写入调整为 run 级写入。

**验收标准**：

- [x] `run:start` 初始化当前 active run
- [x] `turn:start` 创建当前 turn 并追加到 `turns[]`
- [x] `reasoning:delta` 追加到当前 turn 的 `reasoning`
- [x] `text:delta` 追加到当前 turn 的 `content`
- [x] `tool:start` 追加当前 turn 的 `toolCalls`
- [x] `tool:done` 更新对应 `toolCall` 的结果和状态
- [x] `llm:done` 更新当前 turn usage，并累加顶层 usage
- [x] `turn:done` 只结束当前 turn，不写入 `history.jsonl`
- [x] `run:done` 写入一条完整 assistant v2 记录
- [x] 同一次用户请求不会再生成多条 assistant 记录

**状态**：[x] 已完成

---

### 3. 明确 active run key 策略

**描述**：当前事件没有稳定 `runId`，第一阶段按 session 维护单个 active run。

**验收标准**：

- [x] `currentRuns` 或等价状态以 `sessionId` 作为 key
- [x] 如果同一 session 收到新的 `run:start` 且已有未完成 run，先将旧 run 标记为 `interrupted` 并 flush
- [x] 不使用事件 `message.id` 作为 runId
- [x] 不使用 timestamp 拼接 runId 来假装支持并发
- [x] 代码注释说明：如需同 session 并发 run，必须先在事件协议增加真实 `runId`

**状态**：[x] 已完成

---

### 4. 实现异常收口

**描述**：保证未正常完成的 run 不会长期留在内存中。

**验收标准**：

- [x] `run:error` finalize 当前 run，写入 `status: "error"`
- [x] `HistoryWriter.stop()` flush 未完成 run，写入 `status: "interrupted"`
- [x] finalize 时如果当前 turn 未结束，自动补充 `endTime` 和 `status`
- [x] 空 run 且无错误信息时不写 assistant 记录
- [x] 暂不实现定时清理器

**状态**：[x] 已完成

---

### 5. 更新用户消息写入

**描述**：确认 user 消息与 assistant v2 消息在 `history.jsonl` 中组成清晰的一问一答投影。

**验收标准**：

- [x] `writeUserMessage` 继续写入 user 消息
- [x] user 消息结构保持简单：`id/role/timestamp/content`
- [x] 一次用户请求最终对应一条 user 消息和一条 assistant v2 消息
- [x] user 消息不需要 `version: 2`，除非实现时决定整个 history 行统一版本化

**状态**：[x] 已完成

---

### 6. 前端历史加载只消费 v2

**描述**：调整历史加载逻辑，只按 v2 assistant 结构恢复展示消息。

**验收标准**：

- [x] assistant 历史消息要求 `version === 2`
- [x] 顶层 `content` 生成 text block
- [x] 每个 `turn.reasoning` 分别生成独立 thinking block
- [x] `turns[].toolCalls` 展平成 tool blocks
- [x] 顶层 `usage` 生成 stats
- [x] 不实现旧格式 fallback
- [x] 不实现新旧格式混合读取

**状态**：[x] 已完成

---

### 7. 路由层保持薄透传

**描述**：`ThreadRoutes.ts` 只负责读取 `history.jsonl` 并返回消息，不做格式迁移。

**验收标准**：

- [x] 正常解析 JSONL 每一行
- [x] 返回 v2 history 原始消息
- [x] 解析失败的行记录 warn 并跳过
- [x] 不做旧格式转换
- [x] 不做迁移逻辑

**状态**：[x] 已完成

---

### 8. 更新单元测试

**描述**：覆盖 run 级聚合的核心行为。

**验收标准**：

- [x] 单 run 单 turn：写入一条 assistant v2
- [x] 单 run 多 turn：仍只写入一条 assistant v2，且 `turns.length > 1`
- [x] 多次 `llm:done`：顶层 usage 正确累加
- [x] 工具调用：`tool:start/tool:done` 记录到对应 turn
- [x] `turn:done` 不产生 history 写入
- [x] `run:error` 写入 error 状态
- [x] `stop()` flush interrupted run

**状态**：[x] 已完成

---

### 9. 前端恢复验证

**描述**：验证 v2 history 能恢复为前端消息。当前已完成代码路径，自动化前端测试本轮不新增，由用户进行手动验证。

**验收标准**：

- [x] v2 assistant 的 `content` 能恢复为文本块
- [x] v2 assistant 的每个 `turn.reasoning` 能恢复为独立思考块
- [x] `turns[].toolCalls` 能恢复为工具块
- [x] `usage` 能恢复为 stats
- [x] 不添加旧格式测试

**状态**：[x] 已完成

---

### 10. 更新文档

**描述**：更新项目文档，说明 `history.jsonl` v2 契约。

**验收标准**：

- [x] 更新 `src/main/agent/README.md`
- [x] 说明 `history.jsonl` 是前端展示投影
- [x] 说明 assistant v2 字段含义
- [x] 说明旧 history 数据不兼容，实施前需删除
- [x] 不编写迁移指南

**状态**：[x] 已完成

---

### 11. 验证

**描述**：完成实现后的基础验证。

**验收标准**：

- [x] 运行相关单元测试
- [-] 运行 typecheck（`typecheck:node` 通过；全量 web typecheck 被既有错误阻塞）
- [ ] 手动删除旧 `history.jsonl` 后创建新对话
- [ ] 验证新对话生成一条 assistant v2 记录
- [ ] 验证重新打开后不会出现一条实时回复变多条历史回复

**状态**：[ ] 待用户手动验证
