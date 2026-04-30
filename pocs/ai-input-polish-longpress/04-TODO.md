# 输入框 Ctrl 长按 AI 润色 - TODO

## 1. 新增后端 `ai.polishText` RPC

- **目标**：提供一个不依赖 Chat Thread 的轻量文本润色入口。
- **背景**：当前前端 `AIGenerate.vue` 中的 `quickChatStream` 未实现，不能直接调用模型；主进程已有 `ThreadlessExecutor` 可复用。
- **涉及范围**：
  - `src/main/rpc/`
  - `src/main/common/gateway/` 的方法注册点（如需要）
  - `src/main/agent/ThreadlessExecutor.ts`
- **具体动作**：
  - 新增 `aiMethods` 方法组，暴露 `ai.polishText`。
  - 入参支持 `text`、`agentId?`、`promptTemplate?`、`runtimeType?`、`maxTurns?`。
  - 默认 `agentId = 'app-copilot'`，默认 `runtimeType` 先沿用当前 Threadless 默认。
  - 使用默认 prompt 模板构造 message。
  - 调用 `ThreadlessExecutor.run(agentId, message, { lightweight: true, mode: 'chat', maxTurns: 1 })`。
  - 返回 `{ text: string }`。
- **非目标**：
  - 本项不做流式返回。
  - 本项不创建持久化 Thread。
- **验收标准**：
  - [ ] 空文本返回参数错误。
  - [ ] 有文本时返回纯文本结果。
  - [ ] 默认 agent 是 `app-copilot`。
  - [ ] 单元测试覆盖 prompt 构造和默认参数。
- **状态**：[ ]

## 2. 新增前端 `useAITextPolish` 组合式 API

- **目标**：把调用、状态、错误和取消逻辑从指令/UI 中抽离。
- **背景**：旧项目的 AI 状态管理散落在组件和指令中，当前项目更适合先沉到 composable。
- **涉及范围**：
  - `src/renderer/src/composables/useAITextPolish.ts`
  - `src/renderer/src/composables/README.md`（可选）
- **具体动作**：
  - 使用 `useGateway().request` 调用 `ai.polishText`。
  - 暴露 `status`、`isGenerating`、`result`、`error`、`polish(text, options)`、`reset()`。
  - 防止重复并发触发。
  - 允许传入 `promptTemplate` 和 `agentId`。
- **验收标准**：
  - [ ] 调用成功后 `result` 为润色文本。
  - [ ] 调用失败后 `error` 有明确错误信息。
  - [ ] 生成中重复调用不会产生多次请求。
- **状态**：[ ]

## 3. 新增 `v-ai-polish` 指令

- **目标**：让任意输入框通过指令获得 Ctrl/Control 长按润色能力。
- **背景**：用户希望这是一个通用能力，而不是只在某个输入框里硬编码。
- **涉及范围**：
  - `src/renderer/src/directives/ai-polish.ts` 或 `src/renderer/src/directives/AIPolish/index.ts`
  - `src/renderer/src/plugins/` 或应用入口的指令注册点
- **具体动作**：
  - 支持绑定值：
    - 字符串：作为 promptTemplate。
    - 对象：`{ agentId?, promptTemplate?, duration?, autoApply?, disabled?, context? }`。
  - 聚焦输入元素后监听 `keydown`/`keyup`。
  - Ctrl/Control 按住超过 `duration` 后触发。
  - 支持 `input`、`textarea`、`contenteditable`。
  - 生成完成后回填值，并派发 `input` 和 `change`。
  - 指令卸载时清理定时器和事件监听。
- **验收标准**：
  - [ ] 输入框聚焦时长按 Ctrl 可触发。
  - [ ] 释放 Ctrl 前未达到时长不会触发。
  - [ ] 输入框失焦会取消待触发状态。
  - [ ] 回填后 `v-model` 正常更新。
- **状态**：[ ]

## 4. 新增轻量浮层反馈

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
  - [ ] 浮层不遮挡输入内容。
  - [ ] 深色/浅色主题可读。
  - [ ] 不引入页面布局抖动。
- **状态**：[ ]

## 5. 接入一个试点输入框

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
  - [ ] 普通 textarea 可完整体验 Ctrl 长按润色。
  - [ ] 未影响现有保存逻辑。
- **状态**：[ ]

## 6. 后续扩展到通用 `AIGenerate`

- **目标**：把专用润色能力升级为通用 AI 生成底座。
- **背景**：当前项目已有 `components/common/AIGenerate.vue`，但模型调用未接通。
- **涉及范围**：
  - `src/renderer/src/components/common/AIGenerate.vue`
  - `src/renderer/src/composables/useAIGenerate.ts`
  - `src/main/rpc/aiMethods.ts`
- **具体动作**：
  - 将 `ai.polishText` 泛化为 `ai.generate`。
  - 让 `AIGenerate.vue` 复用 `useAIGenerate`。
  - 保留 renderless slot API，避免强制 UI。
- **验收标准**：
  - [ ] 润色、总结、翻译等 preset 可共用同一底层能力。
  - [ ] 旧占位 `quickChatStream` 被移除或替换。
- **状态**：[ ]

