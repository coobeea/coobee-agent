# Insight UI + Backend POC - 问题记录

> 创建时间：2026-04-24

## 问题列表

### BUG-001: 当前项目仅有 Insight 共享类型，缺少可直接复用的前后端实现

- **发现时间**：2026-04-24
- **严重程度**：一般
- **现象**：当前项目存在 `src/shared/types/insight.ts`，但尚未发现完整的后端编排、HTTP 路由、前端页面和 API 封装。
- **原因**：Insight 能力在当前项目中处于“数据模型已铺垫、实现未落地”的状态。
- **解决方案**：按 POC 文档先补齐最小闭环实现，再逐步扩展自动触发、推送和模板编辑能力。
- **状态**：已解决

### BUG-002: 仓库当前全局 typecheck 基线未通过，阻塞本次 POC 的整仓校验

- **发现时间**：2026-05-03
- **严重程度**：一般
- **现象**：执行 `npm run typecheck` 时，`OpenAIAgentRuntime.ts`、`CompressionService.ts`、若干测试文件和 `ExtensionApi.ts` 等既有文件报错，导致无法用整仓 typecheck 作为本次 POC 的最终校验手段。
- **原因**：当前分支在 Insight POC 之外已经存在未清理的 TypeScript 基线问题。
- **解决方案**：先记录这些既有错误，后续单独清理全局类型问题；本次 POC 先以新增文件 IDE 诊断通过为准。
- **状态**：待处理
