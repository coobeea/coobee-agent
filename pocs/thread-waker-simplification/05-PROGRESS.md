# ThreadWaker 过度设计简化 - 进度跟踪

> 创建时间：2026-04-28

## 当前状态：✅ 已实施

---

## 进度记录

### 2026-04-28

- **阶段**：需求分析与方案设计
- **完成**：
  - ✅ 01-需求分析.md — 识别 5 个过度设计问题
  - ✅ 02-方案设计.md — 上中下三策对比，选定函数式简化
  - ✅ 03-反思优化.md — 边界情况、安全、性能评估
  - ✅ 04-TODO.md — 5 个任务项
- **待开始**：代码实施（任务 1-5）

### 2026-04-28

- **阶段**：代码实施
- **完成**：
  - ✅ 将 `ThreadWaker` 类改为 `recoverPendingThreads()` 函数
  - ✅ 删除 EventBus 自循环、`ThreadWakeEvent`、`tool-done` 分支、手动 runStatus 更新
  - ✅ 启动恢复接入 `ReadyAgentSystemHook`，放在工具、Extension、stream consumers 初始化完成之后
  - ✅ 重写 `ThreadWaker.integration.test.ts`
  - ✅ 搜索确认生产代码中无旧 `ThreadWaker` 类、`ThreadWakeEvent`、`thread:wake`、`recoverOnStartup` 引用
  - ✅ 删除 `tool-pending` 持久 runStatus 后，恢复白名单同步简化为仅 `running`
  - ✅ 相关测试与相关文件 ESLint 通过
  - ⚠️ `pnpm run typecheck:node` 仍失败，失败集中在既有 runtime 旧测试和 `CompressionService` 类型问题，非本次 ThreadWaker 改动引入
- **调整/反对意见**：
  - POC 中“纯函数无副作用”的说法不准确；实际函数会读取 ThreadStore 并提交恢复消息，更准确应称为“函数式入口/无驻留监听器”。
  - POC 中建议可在 Gateway 初始化处接入，我认为不合适；恢复会触发真实 Agent 执行，应放在 `ReadyAgentSystemHook` 末尾，确保 ToolRegistry、ExtensionManager 和 stream consumers 均已就绪。
  - POC 中提到 `threadExecutor` “实际定义在 ThreadExecutor.ts 而非 execution/index.ts”，当前实现已按实际路径从 `../ThreadExecutor` 导入。

---

## 里程碑

| 里程碑           | 预计完成   | 实际完成   | 状态 |
| ---------------- | ---------- | ---------- | ---- |
| POC 文档完成     | 2026-04-28 | 2026-04-28 | ✅   |
| ThreadWaker 重写 | -          | 2026-04-28 | ✅   |
| 测试重写         | -          | 2026-04-28 | ✅   |
| 启动流程接入     | -          | 2026-04-28 | ✅   |
| 全量验证通过     | -          | 2026-04-28 | ✅   |
| 代码提交         | -          | -          | ⏸️   |
