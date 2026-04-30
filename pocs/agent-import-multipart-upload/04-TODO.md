# 智能体导入接口 multipart 直传改造 - 待办事项

> 创建时间：2026-04-30
> 关联分支：尚未创建

## 状态说明

- [ ] 待处理
- [x] 已完成
- [-] 已取消

## 待办事项

### 1. 引入 multer 运行时与类型依赖

- **目标**：为后端 multipart 解析引入 `@koa/multer` + `multer` 及其 TypeScript 类型，确保类型检查和运行期都可工作。
- **背景**：项目当前只有 `koa-bodyparser`，没有 multipart 解析能力；`@koa/multer` 是官方绑定，底层复用 multer，与 Koa v2 生态兼容。
- **涉及范围**：
  - `package.json`
  - `pnpm-lock.yaml`
- **具体动作**：
  - `pnpm add @koa/multer multer`
  - `pnpm add -D @types/multer @types/koa__multer`
- **验收标准**：
  - [x] `package.json` 中 `dependencies` 包含 `@koa/multer ^4.0.0` 和 `multer ^2.1.1`
  - [x] `package.json` 中 `devDependencies` 包含 `@types/multer` 和 `@types/koa__multer`
  - [x] `pnpm install` 无报错
- **状态**：[x]

### 2. 新增 koa Request 类型增强文件

- **目标**：通过 TS 接口合并，把 `@koa/multer` 覆盖掉的 `ctx.request.body / file / files` 三个字段重新声明回 koa 的 `Request` 接口。
- **背景**：`@koa/multer` 的 d.ts 会给 `koa` 的 `Request` 做全局接口赋值，直接导致项目内 12 处依赖 `ctx.request.body` 的路由文件全部类型丢失。不补声明就会触发 tsc 大面积红线。
- **涉及范围**：
  - 新增文件：`src/main/types/koa-augment.d.ts`
- **具体动作**：
  - 新建 `koa-augment.d.ts`，`import type { File as MulterFile } from '@koa/multer'`
  - `declare module 'koa'`，在 `Request` 接口内声明 `body?: unknown; file?: MulterFile; files?: MulterFile[] | Record<string, MulterFile[]>`
  - 文件末尾 `export {}` 确保被识别为模块
- **验收标准**：
  - [x] 文件存在并被 `tsconfig.node.json` 的 `include` 匹配（`src/main/**/*`）
  - [x] 原有 5 个 Routes 文件（Chat/Config/File/Thread/Threadless）的 `ctx.request.body` 类型检查通过，无需改动它们本身
  - [x] AgentRoutes 的 3 处 `ctx.request.body` 也恢复正常
- **状态**：[x]

### 3. 后端 AgentRoutes 改造 /agents/import 为 multipart

- **目标**：让 `/gateway/agents/import` 接收 `multipart/form-data`，用 multer 把上传的二进制直接落盘到临时目录，然后把磁盘路径交给既有 `AgentImportExport.importAgent(zipPath)`。
- **背景**：原接口收 JSON body 中的 base64 字符串，存在前端栈溢出 + 后端 JSON 体积限制两道坎。换 multipart 后两道坎同时消除。
- **涉及范围**：
  - `src/main/routes/AgentRoutes.ts`
- **具体动作**：
  - 顶部 `import multer from '@koa/multer'`、`import os from 'node:os'`
  - 定义模块级 `const importUpload = multer({ storage: diskStorage(destination = os.tmpdir(), filename = agent-import-${Date.now()}-${rand}.zip), limits: { fileSize: 200 * 1024 * 1024 } })`
  - `router.post('/agents/import', importUpload.single('file'), ...)` 挂中间件
  - handler 里读取 `ctx.request.file`；若缺失返回 400 `"file is required (multipart/form-data field name: \"file\")"`
  - 打一行 info 日志 `Received upload: name=..., size=..., path=...`
  - `tempZipPath = ctx.request.file.path`，交给 `AgentImportExport.importAgent(tempZipPath)`
  - finally 中 `fs.existsSync` + `fs.unlinkSync` 清理落盘临时文件，清理失败只 warn
- **非目标**：
  - 不修改 `AgentImportExport` 内部实现
  - 不抬高 `GatewayServer` 的 `bodyParser` 全局限制
  - 不处理超大文件（>200MB）的友好化提示（留给后续优化）
- **验收标准**：
  - [x] 路由签名为 `router.post('/agents/import', importUpload.single('file'), handler)`
  - [x] handler 里对 `ctx.request.file` 缺失返回 400
  - [x] finally 清理临时文件，清理失败只 warn 不影响响应
  - [x] tsc 对 AgentRoutes.ts 零报错
- **状态**：[x]

### 4. 前端 api/agents.ts 改造 importAgent 为 FormData

- **目标**：把前端 base64 + JSON 的上传路径替换为 `FormData` + 原生 `fetch` 的二进制直传。
- **背景**：原实现使用 `String.fromCharCode(...uint8Array)` 展开大 Uint8Array 做 base64，32MB 文件必触发栈溢出。
- **涉及范围**：
  - `src/renderer/src/api/agents.ts`
- **具体动作**：
  - 删掉 `file.arrayBuffer()` + `btoa(String.fromCharCode(...))` 逻辑
  - `const formData = new FormData(); formData.append('file', file, file.name);`
  - 用 `fetch(\`${configManager.getBaseUrl()}/gateway/agents/import\`, { method: 'POST', body: formData })`（**不设置 Content-Type**，浏览器自动生成 boundary）
  - try/catch 把网络异常归一成 `ApiResponse<ImportResult> { success: false, error }`
- **非目标**：
  - 不改 `ApiClient.post`（它强制设置 JSON header，与 FormData 冲突；本接口直接 bypass 它）
  - 不改 `AgentView.vue` 调用方
- **验收标准**：
  - [x] `importAgent(file)` 签名不变，仍为 `(file: File) => Promise<ApiResponse<ImportResult>>`
  - [x] 请求头中 Content-Type 由浏览器自动生成（包含 `boundary=`）
  - [x] 失败时返回的 `ApiResponse` 含有 `success: false` 和 `error` 字段
- **状态**：[x]

### 5. 验证 tsc 全量类型检查通过

- **目标**：前后端 tsconfig 下对新增/修改文件和受影响路由文件的类型检查都通过。
- **背景**：multer 的全局类型副作用容易引起连锁报错，必须在接入后立即验证。
- **涉及范围**：
  - `tsconfig.node.json`
  - `tsconfig.web.json`
- **具体动作**：
  - `npx tsc -p tsconfig.node.json --noEmit`
  - `npx tsc -p tsconfig.web.json --noEmit`
  - 排查日志中是否出现 AgentRoutes / api/agents / 其他路由文件的新增报错
- **验收标准**：
  - [x] tsc 输出中 AgentRoutes.ts 零报错
  - [x] tsc 输出中 api/agents.ts 零报错
  - [x] tsc 输出中 ChatRoutes / ConfigRoutes / FileRoutes / ThreadRoutes / ThreadlessRoutes 的 `ctx.request.body` 报错全部消失
  - [x] 仅剩与本 POC 无关的项目遗留错误（如 agent/runtime/**tests**/\* 等既有问题）
- **状态**：[x]

### 6. 补全 multer 上传错误的标准 ApiResponse 返回

- **目标**：保证 `LIMIT_FILE_SIZE`、`LIMIT_UNEXPECTED_FILE` 等 multer 在业务 handler 之前抛出的错误，也能返回统一 `ApiResponse` JSON。
- **背景**：`router.post('/agents/import', importUpload.single('file'), handler)` 中，`single('file')` 先于业务 handler 执行；如果它抛错，handler 内部的 `try/catch/finally` 不会进入，Koa 会返回默认 `500 text/plain`，前端再执行 `response.json()` 会变成 JSON 解析错误。
- **涉及范围**：
  - `src/main/routes/AgentRoutes.ts`
  - `src/main/routes/__tests__/AgentRoutes.import-upload.test.ts`
  - `src/renderer/src/api/agents.ts`
- **具体动作**：
  - 新增 `handleImportUpload` Koa 中间件，内部调用 `importUpload.single('file')` 并捕获上传解析错误。
  - 新增 `createImportUploadErrorResponse(err)`，把 `LIMIT_FILE_SIZE` 映射为 413，把 `LIMIT_UNEXPECTED_FILE` 映射为 400，其它 multer 错误映射为 400。
  - 错误响应统一返回 `{ success: false, code, error }`。
  - 前端 `importAgent(file)` 在 `response.json()` 前检查 `content-type`，如果后端意外返回非 JSON，也归一成 `ApiResponse`。
  - 新增路由测试覆盖字段名错误返回 JSON，以及文件超限错误映射为 413。
- **验收标准**：
  - [x] 错误字段名不会返回 Koa 默认 `500 text/plain`。
  - [x] `LIMIT_FILE_SIZE` 被映射为 HTTP 413。
  - [x] 前端遇到非 JSON 响应也不会抛 JSON 解析异常。
  - [x] 相关 ESLint、定向 Vitest、diff check 通过。
- **状态**：[x]

### 7. 新增智能体导入中的弹出提醒

- **目标**：导入大 ZIP 时给用户明确反馈，避免页面看起来像卡死。
- **背景**：multipart 上传和后端解压 / 拷贝技能文件都需要等待；当前界面只有顶部上传图标轻微 pulse，提示太弱，用户不知道系统是否仍在处理。
- **涉及范围**：
  - `src/renderer/src/views/AgentView.vue`
- **具体动作**：
  - 增加 `importingFile` 状态，记录当前导入文件名和大小。
  - 设置 `importing = true` 后等待一次 `nextTick()`，确保弹窗先渲染再开始请求。
  - 通过 `Teleport to="body"` 显示导入中弹窗，包含 spinner、说明文案、文件名和文件大小。
  - 导入完成或失败后关闭弹窗并清理 `importingFile`。
  - 导入期间禁止重复打开文件选择器。
- **验收标准**：
  - [x] 选择合法 ZIP 后立即出现“正在导入智能体”弹窗。
  - [x] 弹窗显示当前文件名和大小。
  - [x] 导入结束后弹窗自动关闭。
  - [x] 相关 ESLint 通过。
- **状态**：[x]
