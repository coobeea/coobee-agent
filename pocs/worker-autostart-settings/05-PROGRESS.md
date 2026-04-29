# Worker 自启动配置展示 - PROGRESS

> 创建时间：2026-04-29

## 2026-04-29

- `WorkerInfo` 增加 `autoStart`，WorkerManager 状态输出同步该字段。
- 新增 `worker.autoStartUpdate` RPC，写入 `worker.json` 并重载 Worker 配置。
- 设置页列表和详情弹窗增加“随应用启动”开关。
- 详情弹窗“运行状态”区域由大网格压缩为紧凑摘要 chips。
- ESLint 通过；`WorkerManager.config-watch.test.ts` 通过。
- 全量 node/web typecheck 仍受仓库既有错误影响，错误不来自本次 Worker 改动。
