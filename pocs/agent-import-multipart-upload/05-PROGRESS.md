# 智能体导入接口 multipart 直传改造 - 执行进度

> 创建时间：2026-04-30
> 当前状态：已完成

## 实施记录

### 2026-04-30

**任务 1：引入 multer 运行时与类型依赖**

- 执行 `pnpm add @koa/multer multer` → 新增 `@koa/multer@4.0.0`、`multer@2.1.1`
- 执行 `pnpm add -D @types/multer @types/koa__multer` → 新增 `@types/multer@2.1.0`、`@types/koa__multer@2.0.8`
- 修改文件：`package.json`、`pnpm-lock.yaml`

**任务 2：新增 koa Request 类型增强文件**

- 新建文件：`src/main/types/koa-augment.d.ts`
- 通过 `declare module 'koa'` 对 `Request` 接口合并 `body / file / files` 三个字段
- 导入 `@koa/multer` 的 `File` 类型作为 `file` / `files` 的类型

**任务 3：后端 AgentRoutes 改造 /agents/import 为 multipart**

- 修改文件：`src/main/routes/AgentRoutes.ts`
- 顶部新增 `import multer from '@koa/multer'`、`import os from 'node:os'`
- 定义模块级 `importUpload` 中间件，`diskStorage` 指向 `os.tmpdir()`，`limits.fileSize = 200MB`
- 路由签名改为 `router.post('/agents/import', importUpload.single('file'), handler)`
- handler 从 `ctx.request.file` 读取上传信息，打印 size/name/path info 日志
- finally 负责 unlink 临时 zip，清理失败只 warn

**任务 4：前端 api/agents.ts 改造 importAgent 为 FormData**

- 修改文件：`src/renderer/src/api/agents.ts`
- 删除 `arrayBuffer + String.fromCharCode + btoa` 的 base64 链路
- 改为 `new FormData()` + `formData.append('file', file, file.name)` + 原生 `fetch(POST)`
- 不手动设置 Content-Type，浏览器自动生成 multipart boundary
- 失败路径统一归一为 `ApiResponse<ImportResult>{ success: false, error }`

**任务 5：验证 tsc 全量类型检查通过**

- 执行 `npx tsc -p tsconfig.node.json --noEmit`：AgentRoutes、api/agents、其它 Routes 文件均无新增报错，仅剩项目遗留错误（agent/runtime/**tests**/\*、CompressionService.ts 等）
- 执行 `npx tsc -p tsconfig.web.json --noEmit`：无与本改动相关的错误

**任务 6：补全 multer 上传错误的标准 ApiResponse 返回**

- 修改文件：`src/main/routes/AgentRoutes.ts`
- 新增 `handleImportUpload` 包装中间件，捕获 `importUpload.single('file')` 在进入业务 handler 前抛出的错误。
- 新增 `createImportUploadErrorResponse(err)`，将 `LIMIT_FILE_SIZE` 映射为 413，将 `LIMIT_UNEXPECTED_FILE` / `LIMIT_FILE_COUNT` 等映射为 400。
- 修改文件：`src/renderer/src/api/agents.ts`
- `importAgent(file)` 增加非 JSON 响应兜底，避免后端异常返回 `text/plain` 时前端暴露 JSON 解析错误。
- 新增测试：`src/main/routes/__tests__/AgentRoutes.import-upload.test.ts`
- 验证：错误字段名返回 JSON `ApiResponse`；文件超限错误映射为 413。

**任务 7：新增智能体导入中的弹出提醒**

- 修改文件：`src/renderer/src/views/AgentView.vue`
- 新增 `importingFile` 状态，导入时记录 ZIP 文件名和大小。
- 设置 `importing = true` 后 `await nextTick()`，保证弹窗先渲染再开始上传请求。
- 新增 `Teleport` 弹窗，导入中展示 spinner、等待说明、文件名和文件大小。
- 导入结束后关闭弹窗并清理文件状态。

## 本次改动的文件清单

- 新增：`src/main/types/koa-augment.d.ts`
- 新增：`src/main/routes/__tests__/AgentRoutes.import-upload.test.ts`
- 修改：`src/main/routes/AgentRoutes.ts`
- 修改：`src/renderer/src/api/agents.ts`
- 修改：`src/renderer/src/views/AgentView.vue`
- 修改：`package.json` + `pnpm-lock.yaml`（依赖四项）

## 未覆盖项（留给下一轮迭代）

1. 启动期 tmpdir 扫描兜底：清理残留的 `agent-import-*.zip` 孤儿文件。
2. 前后端联调验证：用 32MB 的 `agent-vat-tax-assistant.zip` 在 dev 环境完成一次完整导入链路实测。
