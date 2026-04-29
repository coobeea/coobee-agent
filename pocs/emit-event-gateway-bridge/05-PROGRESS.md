# emit_event 后端到前端事件链路缺失 - PROGRESS

> 创建时间：2026-04-29
> 最近更新：2026-04-29

## 进度记录

| 日期       | 内容                                                                                 | 状态      |
| ---------- | ------------------------------------------------------------------------------------ | --------- |
| 2026-04-29 | 问题发现：`emit_event` 事件链路在 EventBus 处断裂                                    | ✅ 完成   |
| 2026-04-29 | 初版 POC 文档创建（需求分析、方案设计、反思优化、TODO、PROGRESS、BUGS）              | ✅ 完成   |
| 2026-04-29 | 完成方案评审：确认事件名映射、Publisher 注册形式、前端分层、TODO 粒度存在问题        | ✅ 完成   |
| 2026-04-29 | 第一轮修订：选定“类型化三事件链路”方案                                               | ✅ 完成   |
| 2026-04-29 | 第二轮修订：按用户意见改为固定 `agent:message` + `action` + `payload.text/data` 结构 | ✅ 完成   |
| -          | T1: 定义 `src/shared/events/agent.ts` 的 AgentMessage 契约                           | ⬜ 待实施 |
| -          | T2: 扩展 shared Gateway 与 frontend 事件类型                                         | ⬜ 待实施 |
| -          | T3: 改造 `emit_event` 工具为 AgentMessage 发射端                                     | ⬜ 待实施 |
| -          | T4: 新增数组形式的 `AgentMessagePublisher`                                           | ⬜ 待实施 |
| -          | T5: 修改 `gatewaySetup.ts` 桥接 `agent:message`                                      | ⬜ 待实施 |
| -          | T6: 新增 `agentEventsHandle.ts` 按 action 执行前端 UI 行为                           | ⬜ 待实施 |
| -          | T7: 更新后端单元测试                                                                 | ⬜ 待实施 |
| -          | T8: 新增或补充前端 handler 测试                                                      | ⬜ 待实施 |
| -          | T9: 手动端到端验证                                                                   | ⬜ 待实施 |
