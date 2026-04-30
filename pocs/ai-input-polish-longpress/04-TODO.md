# 输入框 Ctrl 长按 AI 润色 - TODO

## 1. 新增后端 Threadless HTTP 路由

- **目标**：提供一个不依赖持久化 Chat Thread 的轻量 Agent 调用入口，供前端通用 AI 能力复用。
- **通信协议**：**HTTP**（非 WebSocket RPC）。因为 Threadless 场景是一次请求、一次响应，无需监听 `stream:*` 事件，HTTP 可直接得到最终文本，不依赖 WS 连接状态。
- **背景**：后端已有 `ThreadlessExecutor.runMessage`，但前端目前只能通过 Gateway/RPC 发起请求；如果继续做专用 `ai.polishText`，后续摘要、翻译、字段生成都会重复造接口。
- **涉及范围**：
  - `src/shared/api/threadless-types.ts`（`ThreadlessRunReqVO` / `ThreadlessRunRespVO`）
  - `src/main/routes/ThreadlessRoutes.ts`
  - `src/main/agent/ThreadlessExecutor.ts`
  - `src/main/agent/execution/__tests__/ThreadlessExecutor.test.ts`
- **具体动作**：
  - 新增 `ThreadlessRoutes.ts`，文件名以 `Routes.ts` 结尾，Gateway 会自动扫描 `src/main/routes/*Routes.ts`。
  - 注册端点：`POST /gateway/threadless/run`。
  - 请求体支持 `agentId?`、`message`、`instructions?`、`runtimeType?`、`mode?`、`lightweight?`、`maxTurns?`、`sessionId?`、`modelOverride?`、`promptVars?`、`metadata?`。
  - 默认 `agentId = 'app-copilot'`、`mode = 'chat'`、`lightweight = true`、`maxTurns = 1`。
  - 校验 `message` 必须是非空字符串，`runtimeType` 只能是 `pi-mono | openai | claude`。
  - 调用 `ThreadlessExecutor.runMessage(params)`，响应统一为 `ApiResponse<ThreadlessRunRespVO>`：`{ success: true, data: { text, sessionId?, usage? } }` 或 `{ success: false, error }`。
  - 监听 `ctx.req.on('close')`，取消时调用底层 `AbortSignal` 中断执行，避免模型空跑。
  - 扩展 `ThreadlessExecutionOptions`：允许 `instructions?` 作为本次请求的附加系统约束，允许 `modelOverride?` 覆盖 agent 默认模型。
  - 在 `ThreadlessExecutor.createRequest` 中合成最终请求：保留 agent 自身 instructions，同时把本次 `instructions` 追加为一次性约束。
  - 注册函数结尾输出日志 `log.info('[ThreadlessRoutes] HTTP 路由注册完成')`，与其他 Routes 结构一致。
- **非目标**：
  - 本项不创建持久化 Thread。
  - 本项不写入 `chatStore`。
  - 本项先不做流式响应（`POST /gateway/threadless/run/stream` SSE 版本归到任务 8）。
- **验收标准**：
  - [x] `POST /gateway/threadless/run` 能被 `curl` 以 `Content-Type: application/json` 调通。
  - [x] 空 `message` 返回 `{ success: false, error }`，状态码 400。
  - [x] 未传 `agentId` 时默认使用 `app-copilot`。
  - [x] `instructions` 能影响本次执行请求，但不修改 Agent 配置。
  - [ ] 客户端断开连接时服务端能通过 `AbortSignal` 中断执行。
  - [ ] 单元测试覆盖默认参数、参数校验、`instructions` 合成。
- **状态**：[x] 主体实现完成；连接关闭中断与单测待补充

## 2. 新增前端 `useThreadExecutor` 组合式 API

- **目标**：把“已有会话”的 Agent 请求封装成类型化 composable，减少业务组件直接写 Gateway 方法名。
- **背景**：当前 `HomeView`、`AgentView`、`ChatPanel` 等位置直接调用 `chat.createThread`、`chat.sendMessage`、`chat.abortMessage`，后续新增参数时容易散落。
- **涉及范围**：
  - `src/renderer/src/composables/useThreadExecutor.ts`
  - `src/renderer/src/composables/README.md`
  - 可选：`src/shared/api/thread-types.ts`
- **具体动作**：
  - 基于 `useGateway().request` 封装 `createThread(options)`、`sendMessage(options)`、`abortMessage(threadId)`。
  - `createThread` 入参支持 `title?`、`agentId?`、`overrideModel?`、`runtimeType?`、`enableThinking?`、`asrEnabled?`、`ttsEnabled?`。
  - `sendMessage` 入参支持 `threadId`、`message`、`runtimeType?`。
  - `abortMessage` 入参使用 `threadId` 字符串，内部转换成 `{ threadId }`。
  - 暴露 `connectionState`、`lastError`，方便调用方沿用 Gateway 状态。
  - 文档中说明：流式消息仍走 `stream:*` 事件，不在该 composable 内拼接。
- **非目标**：
  - 本项不改现有聊天消息渲染。
  - 本项不替换 `chatStore.handleStreamMessage`。
- **验收标准**：
  - [x] `useThreadExecutor` 不直接导入 `gateway`，只通过 `useGateway`。
  - [x] 三个方法的 RPC 名称集中在该文件中。
  - [ ] README 有基本调用示例。
- **状态**：[x] 主体实现完成；README 待补充

## 3. 新增前端 `useThreadlessExecutor` 组合式 API

- **目标**：把“无会话轻量 Agent 请求”封装成通用 composable，为润色、摘要、翻译等功能提供统一入口。
- **通信协议**：**HTTP**，底层使用 `apiClient.post`（`src/renderer/src/api/client.ts`），调用 `POST /gateway/threadless/run`。不走 `useGateway().request`，不依赖 WS 连接状态。
- **背景**：用户希望前端能定义与后端 `ThreadlessExecutor` 对应的方法，并能传递 `instructions` 等额外参数。
- **涉及范围**：
  - `src/renderer/src/api/threadless.ts`（基于 `apiClient` 的薄封装）
  - `src/renderer/src/composables/useThreadlessExecutor.ts`
  - `src/renderer/src/composables/README.md`
  - `src/shared/api/threadless-types.ts`
- **具体动作**：
  - `src/renderer/src/api/threadless.ts` 导出 `runThreadless(payload): Promise<ApiResponse<ThreadlessRunRespVO>>`，内部调 `apiClient.post('/threadless/run', payload)`（`apiClient` 的 `BASE_URL` 已带 `/gateway` 前缀，以配置为准）。
  - `useThreadlessExecutor` 封装 `run(options)`，入参支持 `agentId?`、`message`、`instructions?`、`runtimeType?`、`mode?`、`lightweight?`、`maxTurns?`、`sessionId?`、`modelOverride?`、`promptVars?`、`metadata?`、`signal?: AbortSignal`。
  - 默认值在前端和后端保持一致：`agentId = 'app-copilot'`、`mode = 'chat'`、`lightweight = true`、`maxTurns = 1`。
  - 返回值定义为 `{ text: string, sessionId?: string, usage?: unknown }`，即使初版后端只返回 `text`，前端类型也保留扩展口。
  - 对空 `message` 在前端先做保护，避免无意义 HTTP。
  - 错误归一：当 `ApiResponse.success === false` 时 `throw new Error(response.error)`；网络异常直接向上抛。
  - 文档中说明：该 composable 不创建 Thread、不触碰 `chatStore`、不监听 `stream:*`。
- **非目标**：
  - 本项先不实现 `stream`。
  - 本项不提供具体业务 prompt。
- **验收标准**：
  - [x] `run({ message })` 能调用 `POST /gateway/threadless/run` 并返回 `text`。
  - [x] 支持传入 `instructions`、`agentId`、`runtimeType` 等参数。
  - [x] 支持外部传入 `AbortSignal`，调用 `abort()` 后服务端能接收到连接关闭。
  - [x] 空 `message` 不发起请求并返回明确错误。
  - [ ] README 有“一句话润色”之外的通用调用示例。
- **状态**：[x] 主体实现完成；README 待补充

## 4. 新增前端 `useAITextPolish` 组合式 API

- **目标**：把润色 prompt、状态、错误和防重复触发逻辑从指令/UI 中抽离。
- **背景**：`useThreadlessExecutor` 只负责通用执行，不应该知道“一句话润色”这种业务 preset。
- **涉及范围**：
  - `src/renderer/src/composables/useAITextPolish.ts`
  - `src/renderer/src/composables/README.md`
- **具体动作**：
  - 内部调用 `useThreadlessExecutor().run(...)`，不直接调用 `useGateway`。
  - 暴露 `status`、`isGenerating`、`result`、`error`、`polish(text, options)`、`reset()`。
  - `polish` options 支持 `agentId?`、`instructions?`、`promptTemplate?`、`runtimeType?`、`context?`、`label?`、`placeholder?`。
  - 默认 `instructions` 强约束“只返回润色后的文本，不要解释，不要 Markdown”。
  - 默认 message 使用模板变量 `text`、`label`、`placeholder`、`context`。
  - 生成中重复触发时忽略并保留当前请求状态。
- **非目标**：
  - 本项不做 DOM 回填。
  - 本项不做长按监听。
- **验收标准**：
  - [x] 调用成功后 `result` 为润色文本。
  - [x] 调用失败后 `error` 有明确错误信息。
  - [x] 生成中重复调用不会产生多次请求。
  - [x] `useAITextPolish` 的底层调用只依赖 `useThreadlessExecutor`。
- **状态**：[x]

## 5. 新增 `v-ai-polish` 指令

- **目标**：让任意输入框通过指令获得 Ctrl/Control 长按润色能力。
- **背景**：用户希望这是一个通用能力，而不是只在某个输入框里硬编码。
- **涉及范围**：
  - `src/renderer/src/directives/ai-polish.ts` 或 `src/renderer/src/directives/AIPolish/index.ts`
  - `src/renderer/src/plugins/` 或应用入口的指令注册点
- **具体动作**：
  - 支持绑定值：
    - 字符串：作为 `promptTemplate`。
    - 对象：`{ agentId?, instructions?, promptTemplate?, duration?, autoApply?, disabled?, context? }`。
  - 聚焦输入元素后监听 `keydown`/`keyup`。
  - Ctrl/Control 按住超过 `duration` 后触发。
  - 支持 `input`、`textarea`、`contenteditable`。
  - 调用 `useAITextPolish` 执行润色。
  - 生成完成后回填值，并派发 `input` 和 `change`。
  - 指令卸载时清理定时器和事件监听。
- **验收标准**：
  - [x] 输入框聚焦时长按 Ctrl 可触发。
  - [x] 释放 Ctrl 前未达到时长不会触发。
  - [x] 输入框失焦会取消待触发状态。
  - [x] 回填后 `v-model` 正常更新。
- **状态**：[x]

## 6. 新增轻量浮层反馈

- **目标**：给用户明确的等待、生成中、完成、失败反馈。
- **背景**：旧项目的浮层反馈是好点，应保留，但当前项目需要更轻、更适配现有设计。
- **涉及范围**：
  - 指令内部动态挂载组件，或 `components/common/AIInlineIndicator.vue`
- **具体动作**：
  - 待触发：显示“继续按住 Ctrl 润色”。
  - 生成中：显示 spinner 和“正在润色”。
  - 完成：短暂显示“已润色”。
  - 失败：显示错误提示，2 秒后隐藏。
  - 位置跟随目标输入框下方或右上角。
- **验收标准**：
  - [x] 浮层不遮挡输入内容。
  - [ ] 深色/浅色主题可读。
  - [x] 不引入页面布局抖动。
- **状态**：[x] 初版（已集成在指令内）；主题适配待评估

## 7. 接入一个试点输入框

- **目标**：用最小范围验证交互和调用链路。
- **背景**：先不要全局铺开，避免影响所有输入框。
- **候选范围**：
  - 智能体编辑页的“描述”或“开场白”输入框。
  - Chat 输入框后续单独处理，因为 TipTap/contenteditable 适配更复杂。
- **具体动作**：
  - 给一个普通 `textarea` 添加 `v-ai-polish`。
  - 使用默认 agent 和默认 prompt。
  - 观察回填、状态和错误体验。
- **验收标准**：
  - [x] 普通 textarea 可完整体验 Ctrl 长按润色。
  - [x] 未影响现有保存逻辑。
- **状态**：[x] 已在 `AgentEditorView.vue` 的“描述” textarea 接入

## 8. 后续扩展到通用 `AIGenerate` 与 SSE 流式

- **目标**：把专用润色能力升级为通用 AI 生成底座，并为需要实时预览的场景提供 SSE 流式。
- **背景**：当前项目已有 `components/common/AIGenerate.vue`，但模型调用未接通；初版同步 HTTP 体验弱于旧项目流式预览。
- **涉及范围**：
  - `src/main/routes/ThreadlessRoutes.ts`（新增 SSE 端点 `POST /gateway/threadless/run/stream`）
  - `src/renderer/src/components/common/AIGenerate.vue`
  - `src/renderer/src/composables/useAIGenerate.ts`
  - `src/renderer/src/composables/useThreadlessExecutor.ts`（新增 `stream(options)` 方法，基于 `EventSource` 或 `fetch + ReadableStream`）
- **具体动作**：
  - 后端 SSE 端点重复复用 `ThreadlessExecutor.stream`，向客户端推 `text:delta`、`done`、`error`三类事件。
  - 让 `AIGenerate.vue` 复用 `useThreadlessExecutor` 或 `useAIGenerate`。
  - 保留 renderless slot API，避免强制 UI。
  - 将润色、总结、翻译等 preset 统一收敛到底层 `threadless/run`。
  - 旧占位 `quickChatStream` 移除或替换成真实调用。
- **验收标准**：
  - [ ] 润色、总结、翻译等 preset 可共用同一底层能力。
  - [ ] SSE 流式端点能实时推送 `text:delta` 至前端。
  - [ ] 旧占位 `quickChatStream` 被移除或替换。
- **状态**：[ ]
