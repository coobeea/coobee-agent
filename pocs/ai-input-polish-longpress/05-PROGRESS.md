# 输入框 Ctrl 长按 AI 润色 - PROGRESS

- 2026-04-30：已阅读旧项目 `AIGenerate.vue`、`AiForm.vue`、`AIFormItem.vue` 和 `directives/AIGenerate`。
- 2026-04-30：已确认旧项目可吸收点：renderless、指令化、长按等待态、处理中浮层、生成完成回填。
- 2026-04-30：已确认当前项目 `components/common/AIGenerate.vue` 的 `quickChatStream` 仍是占位。
- 2026-04-30：已确认当前项目可复用 `ThreadlessExecutor`，默认 agent 可使用 `app-copilot`。
- 2026-04-30：已完成 POC 初版方案设计，当时推荐先做专用 `ai.polishText` + `useAITextPolish` + `v-ai-polish`。
- 2026-04-30：根据前端发起 Agent 请求的现状，已将方案调整为 `useThreadExecutor` / `useThreadlessExecutor` composable + 后端 `threadless.run` RPC；`useAITextPolish` 作为上层 preset，不再直接依赖 Gateway 方法名。
- 2026-04-30：用户指出 Threadless 场景是一次请求、一次响应，无需 WS 监听；决策将 `useThreadlessExecutor` 通信协议从 WebSocket RPC 改为 HTTP，后端对应新增 `POST /gateway/threadless/run` HTTP 路由（`src/main/routes/ThreadlessRoutes.ts`），走 `ApiResponse<T>` 统一契约；`useThreadExecutor`（Chat）维持 WS RPC。
- 2026-04-30：同步更新 `02-方案设计.md`、`03-反思优化.md`、`04-TODO.md` 中与通信协议、取消链路、文件布局相关的描述；新增 `src/shared/api/threadless-types.ts` 和 `src/renderer/src/api/threadless.ts` 的落地步骤。
- 2026-04-30：后端落地完成 — 新增 `src/shared/api/threadless-types.ts`（ReqVO/RespVO/runtime & mode 枚举）、`src/main/routes/ThreadlessRoutes.ts`（`POST /gateway/threadless/run`，参数校验 + 默认值 + `ApiResponse<T>`），并扩展 `ThreadlessExecutor.ThreadlessExecutionOptions` 支持 `instructions?` / `modelOverride?`，`createRequest` 中合成最终 instructions。
- 2026-04-30：前端落地完成 — 新增 `src/renderer/src/api/threadless.ts`（`fetch` + `AbortSignal`）、`useThreadlessExecutor`（HTTP 执行器）、`useThreadExecutor`（已有会话的 WS RPC 封装）、`useAITextPolish`（业务 preset：默认 instructions + 防重复触发 + 状态机）。
- 2026-04-30：新增 `v-ai-polish` 指令（`src/renderer/src/directives/aiPolish.ts`）并在 `directives/index.ts` 全局注册；指令支持 `input`/`textarea`/`contenteditable`，内置轻量浮层反馈（hint/loading/success/error），失焦自动 abort，卸载时清理定时器和事件监听。
- 2026-04-30：试点接入 — `AgentEditorView.vue` 的 “智能体描述” `textarea` 加上 `v-ai-polish`，传入 `label/placeholder/context` 三个业务变量；`tsc` 类型检查新增文件均无报错（仅项目遗留错误）。
