# 输入框 Ctrl 长按 AI 润色 - BUGS

当前仍处于 POC 阶段，尚未实现代码。

## 已知风险

- `app-copilot` 当前系统提示词偏“应用管家”，用于润色时必须用强约束 prompt，避免输出解释或多句回复。
- 初版后端只提供同步 HTTP `POST /gateway/threadless/run`，无法像旧项目一样实时预览生成片段；需要时补 SSE 端点 `POST /gateway/threadless/run/stream`。
- HTTP 同步请求受浏览器 `fetch` 和底层网关默认超时约束；如果模型生成时间较长，可能出现前端连接断开而服务端继续跑的情形，需要服务端 `ctx.req.on('close')` + `AbortSignal` 链路稳定才能避免空跑。
- `AbortController` 在 Electron renderer 下的 `fetch` 实现行为要实际验证，避免取消后 `Response` 已消耗导致的错误归一问题。
- `apiClient` 当前对异常只返回 `{ success: false, error }`，不报错码；`useThreadlessExecutor` 需要自己区分“参数校验失败”与“模型执行失败”，便于 UI 展示。
- TipTap ChatInput 是 contenteditable/editor 实例，不能完全按普通 `input.value` 处理，需要单独适配。
- Ctrl/Control 长按可能与浏览器或系统快捷键冲突，需要只在输入框聚焦且没有其他组合键时触发。
