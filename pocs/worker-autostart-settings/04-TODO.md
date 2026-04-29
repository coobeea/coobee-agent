# Worker 自启动配置展示 - TODO

> 创建时间：2026-04-29

## T1 暴露 Worker autoStart 状态

- **范围**：`src/shared/events/worker.ts`、`src/main/common/worker/WorkerManager.ts`
- **验收标准**：
  - [x] `WorkerInfo` 包含 `autoStart`
  - [x] WorkerManager 返回状态时带出 `worker.config.autoStart`
- **状态**：[x]

## T2 支持更新 worker.json autoStart

- **范围**：`src/main/rpc/WorkerMethods.ts`
- **验收标准**：
  - [x] 新增 RPC 直接写入 `worker.json`
  - [x] 写入后触发 WorkerManager 配置重载
  - [x] 非布尔值会返回参数错误
- **状态**：[x]

## T3 设置页展示自启动开关并压缩运行状态

- **范围**：`src/renderer/src/views/settings/WorkersSettings.vue`
- **验收标准**：
  - [x] 列表和详情中能看到自启动状态
  - [x] 可以从 UI 切换自启动
  - [x] 运行状态区域改成紧凑摘要
- **状态**：[x]

## T4 验证

- **验收标准**：
  - [x] 相关文件 ESLint 通过
  - [x] WorkerManager 配置监控测试通过
  - [x] 记录全量 typecheck 的既有阻塞项
- **状态**：[x]
