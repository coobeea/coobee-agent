# 输入框 Ctrl 长按 AI 润色 - PROGRESS

- 2026-04-30：已阅读旧项目 `AIGenerate.vue`、`AiForm.vue`、`AIFormItem.vue` 和 `directives/AIGenerate`。
- 2026-04-30：已确认旧项目可吸收点：renderless、指令化、长按等待态、处理中浮层、生成完成回填。
- 2026-04-30：已确认当前项目 `components/common/AIGenerate.vue` 的 `quickChatStream` 仍是占位。
- 2026-04-30：已确认当前项目可复用 `ThreadlessExecutor`，默认 agent 可使用 `app-copilot`。
- 2026-04-30：已完成 POC 初版方案设计，当时推荐先做专用 `ai.polishText` + `useAITextPolish` + `v-ai-polish`。
- 2026-04-30：根据前端发起 Agent 请求的现状，已将方案调整为 `useThreadExecutor` / `useThreadlessExecutor` composable + 后端 `threadless.run` RPC；`useAITextPolish` 作为上层 preset，不再直接依赖 Gateway 方法名。
