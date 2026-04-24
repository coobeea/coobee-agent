# history.jsonl 结构重构 - 执行进度

> 创建时间：2026-04-24  
> 当前状态：代码实现完成，待用户手动测试

## 实施记录

### 2026-04-24

- 完成需求分析文档（01-需求分析.md）
- 完成方案设计文档（02-方案设计.md）
- 完成反思优化文档（03-反思优化.md）
- 完成待办事项规划（04-TODO.md）
- 初始化进度跟踪文档（本文件）
- 初始化问题记录文档（06-BUGS.md）
- 根据用户确认，移除旧格式兼容、迁移、新旧混合读取等设计
- 将方案收敛为「Run 级聚合 + v2 单格式」
- 明确旧 `history.jsonl` 数据由实施前直接删除，不纳入代码处理范围
- 更新 `02-方案设计.md`、`03-反思优化.md`、`04-TODO.md` 与 `01-需求分析.md` 的相关约束
- 实现 `HistoryWriter` run 级聚合，`run:done` 写入 assistant v2，`turn:done` 不再写盘
- 增加 v2 history 类型定义：`HistoryAssistantMessageV2`、`TurnRecord`、`ToolCallRecord`、`UsageRecord`
- 实现 `run:error` 和 `stop()` 对未完成 run 的收口
- 调整前端历史加载，只消费 assistant `version === 2`
- 更新 `src/main/agent/README.md` 的 `history.jsonl v2` 契约说明
- 更新 `StreamConsumersWriters.test.ts` 覆盖单 turn、多 turn、工具调用、usage 累加、error/interrupted
- 验证：目标单测通过，`typecheck:node` 通过；全量 `typecheck` 仍受既有 web 类型错误阻塞
- 根据复审调整 v2 契约：移除 assistant 顶层 `reasoning`，保留每个 `turn.reasoning` 以支持多轮思考分开展示
- 补充工具参数采集：从 `tool:pending`、`tool:done.toolArgs` 和 OpenAI `tool:start.arguments` 回填 `toolCalls.arguments`
- 调整前端历史恢复：按 `turns[]` 顺序生成 thinking/tool/text blocks，每轮 reasoning 独立展示
