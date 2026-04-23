# P2 - 性能与稳定性优化：Bug 跟踪

> 创建时间：2026-04-22
> 最后更新：2026-04-23
> 当前状态：无阻塞 Bug

## Bug 列表

### 问题 #1：CoreSkills 删除存在兼容风险

**发现时间**：2026-04-23

**问题描述**：
直接删除 `CoreSkills` 可能影响外部旧调用方或第三方 Extension。

**影响范围**：

- [ ] 阻塞当前任务
- [x] 影响兼容性判断
- [ ] 影响运行时主链路

**解决方案**：
不直接完全删除兼容实现，而是将实现迁入 `src/main/agent/skills/legacy/CoreSkills.ts`，并标记 `@deprecated`。主路径 `src/main/agent/skills/CoreSkills.ts` 删除，避免新代码继续误用。

**状态**：

- [x] 已解决

---

### 问题 #2：异步写盘可能在会话结束前未落盘

**发现时间**：2026-04-23

**问题描述**：
EventWriter / HistoryWriter 异步化后，如果会话结束时直接清理 session cache，可能导致队列中的 JSONL 行尚未写入磁盘。

**影响范围**：

- [ ] 阻塞当前任务
- [x] 影响历史完整性
- [x] 影响退出路径稳定性

**解决方案**：
`EventWriter.clearSession()`、`HistoryWriter.clearSession()`、`StreamConsumersManager.clearSession()`、`StreamConsumersManager.destroy()` 全部改为等待 flush；`AgentExecutor` finally 和 `BeforeQuitAgentSystemHook` 对应改为 `await`。

**状态**：

- [x] 已解决

---

### 问题 #3：全量手动性能基准未建立

**发现时间**：2026-04-23

**问题描述**：
本轮实现了异步队列和单元测试，但未建立正式的 100 events/s 手动性能基准。

**影响范围**：

- [ ] 阻塞当前任务
- [x] 影响量化性能对比
- [ ] 影响功能正确性

**解决方案**：
已补充 100 events/s 基准流量自动化烟测：一次性写入 1000 条 JSONL，验证 flush 后无丢失、顺序完整，并设置宽松耗时阈值。桌面端真实 Agent 高频输出人工压测仍可后续单独执行，但不再阻塞 P2 自动化验收。

**状态**：

- [x] 已解决

---

### 问题 #4：Worker 写盘路径不能默认打开

**发现时间**：2026-04-23

**问题描述**：
Worker 写盘可以进一步降低高频落盘对主进程事件循环的影响，但如果默认启用，会把原本已经验证过的普通异步 append 路径替换成新路径，增加运行时不确定性。

**影响范围**：

- [ ] 阻塞当前任务
- [x] 影响稳定性判断
- [x] 影响后续性能压测策略

**解决方案**：
Worker 写盘设计为可选路径：默认仍使用普通异步 append；只有传入 `useWorker: true` 或设置 `COOBEE_AGENT_STREAM_WRITE_WORKER=1` 时启用。Worker append 失败会回退到普通异步 append，`closeAll()` 会负责关闭 Worker。

**状态**：

- [x] 已解决

## 当前结论

- 当前无阻塞 Bug。
- P2 自动化验证已通过。
- Store 异步化、Worker 写盘路径和 100 events/s 自动基准烟测已补齐。
- 剩余未做的是桌面端真实 Agent 高频输出人工压测。
