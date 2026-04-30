# 智能体导入接口 multipart 直传改造 - 问题记录

> 创建时间：2026-04-30

## 问题列表

### BUG-001: 前端大文件 base64 编码触发 Maximum call stack size exceeded

- **发现时间**：2026-04-30
- **严重程度**：阻塞
- **现象**：在 AgentView 导入 32MB 的 `agent-vat-tax-assistant.zip`，前端控制台抛 `RangeError: Maximum call stack size exceeded`，请求根本未离开浏览器；后端 `gateway-http-agents.log` 无任何 `/agents/import` 记录。
- **原因**：`src/renderer/src/api/agents.ts` 的 `importAgent()` 使用 `btoa(String.fromCharCode(...uint8Array))` 做 base64 编码。`...uint8Array` 把三千多万个字节展开成函数实参，超过 V8 参数数量上限。
- **解决方案**：整体切换为 multipart/form-data 直传，前端改用 `FormData`，彻底不再做 base64 编码。
- **状态**：已解决（随 POC 主体方案一并修复）

### BUG-002: 后端 koa-bodyparser 默认 jsonLimit 为 1MB，阻挡大包

- **发现时间**：2026-04-30
- **严重程度**：严重（BUG-001 修复后会变成阻塞）
- **现象**：即便前端成功把 32MB 做成 42.6MB 的 base64 字符串塞进 JSON body，`koa-bodyparser` 默认 `jsonLimit: '1mb'`，请求会被直接 413 拒掉。
- **原因**：`src/main/common/gateway/GatewayServer.ts:88` 调用 `this.app.use(bodyParser())` 没有传任何体积配置，走的是默认值。
- **解决方案**：切换到 multipart 后，导入接口不再经过 bodyParser JSON 分支，问题自然消失。bodyParser 的默认限制对其它 JSON 接口反而是合理默认值，保持不变。
- **状态**：已解决（随 POC 主体方案规避）

### BUG-003: @koa/multer 的 d.ts 替换 koa Request 类型，引发 12 处路由文件类型红线

- **发现时间**：2026-04-30（在任务 3 完成后首次 `tsc --noEmit` 中暴露）
- **严重程度**：严重
- **现象**：引入 `@koa/multer` 并在 `AgentRoutes.ts` 中 `import multer from '@koa/multer'` 之后，tsc 报错：
  ```
  Property 'body' does not exist on type 'Request & { params: Record<string, string>; }'
  ```
  涉及 ChatRoutes、ConfigRoutes、FileRoutes、ThreadRoutes、ThreadlessRoutes、AgentRoutes 共 12 处调用 `ctx.request.body` 的位置。
- **原因**：`@koa/multer` 的类型声明对 `koa` 的 `Request` 接口做了全局合并覆盖，删掉了 `koa-bodyparser` 运行期注入的 `body` 字段。一旦任何一个文件 import 它，整个项目的类型都会被污染。
- **解决方案**：新增 `src/main/types/koa-augment.d.ts`，通过 `declare module 'koa' { interface Request { body?: unknown; file?: MulterFile; files?: ... } }` 做接口合并，把 `body / file / files` 字段重新声明回去。一次性修复所有 12 处报错，不需要逐个打类型逃逸补丁。
- **状态**：已解决

### BUG-004：multer 上传错误返回 Koa 默认 500 / text/plain

- **发现时间**：2026-04-30 反思阶段
- **严重程度**：严重
- **现象**：若用户上传 > 200MB 的文件，multer 会抛 `MulterError: LIMIT_FILE_SIZE`；若字段名不是 `file`，会抛 `LIMIT_UNEXPECTED_FILE`。这些错误发生在业务 handler 之前，Koa 默认返回 `500 text/plain`，前端再执行 `response.json()` 会暴露 JSON 解析错误。
- **原因**：`importUpload.single('file')` 作为独立中间件先执行，handler 内部的 `try/catch` 捕获不到它抛出的错误。
- **解决方案**：新增 `handleImportUpload` 包装中间件，内部捕获 multer 错误并统一转换成 `ApiResponse`。`LIMIT_FILE_SIZE` 返回 413，`LIMIT_UNEXPECTED_FILE` / `LIMIT_FILE_COUNT` 返回 400；前端 `importAgent` 增加非 JSON 响应兜底。
- **状态**：已解决

### BUG-005：导入大包时界面缺少明确处理中反馈

- **发现时间**：2026-04-30
- **严重程度**：中等
- **现象**：导入较大的智能体 ZIP 时，页面只有上传按钮图标轻微变化，用户容易误以为界面卡住或导入没有开始。
- **原因**：前端只有 `importing` 布尔值用于禁用按钮，没有提供页面级的导入中弹窗，也没有展示当前处理的文件信息。
- **解决方案**：在 `AgentView.vue` 中新增导入中弹窗。选择 ZIP 后记录文件名和大小，先渲染弹窗再发起上传请求，导入完成后自动关闭。
- **状态**：已解决
