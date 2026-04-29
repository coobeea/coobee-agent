# ASR 语音对话输入区 - TODO

> 创建时间：2026-04-29

## T1 新增通用语音对话输入组件

- **目标**：提供不含普通文本输入框的语音对话输入区。
- **涉及范围**：`src/renderer/src/components/chat/VoiceConversationInput.vue`
- **具体动作**：实现 ASR Worker 状态展示、启动入口、麦克风监听、静音切换、实时识别文本展示、final 文本发送事件、停止事件和工具栏 slot。
- **验收标准**：
  - [x] 组件不渲染 Tiptap 或普通文本输入框。
  - [x] final ASR 文本通过 `send` 事件交给父组件。
  - [x] 组件卸载时释放麦克风、AudioContext 和 WebSocket。
- **状态**：[x]

## T2 ChatComposer 按 ASR 状态切换输入模式

- **目标**：ASR 开启时只显示语音对话模式，ASR 关闭时恢复普通文本输入。
- **涉及范围**：`src/renderer/src/components/chat/ChatComposer.vue`
- **具体动作**：引入 `VoiceConversationInput`，复用原工具栏控件，调整 ref 暴露逻辑。
- **验收标准**：
  - [x] `asrEnabled` 为 true 时不显示 `ChatInput`。
  - [x] 运行配置入口仍可见，可关闭 ASR。
  - [x] 文本模式的发送、停止、文件引用插入行为不受影响。
- **状态**：[x]

## T3 验证

- **目标**：确认新增组件和接入代码满足基础质量检查。
- **涉及范围**：新增组件、`ChatComposer.vue`
- **具体动作**：运行单文件 ESLint，必要时记录仓库已有类型检查问题。
- **验收标准**：
  - [x] 相关文件 ESLint 通过。
  - [x] 若全量类型检查失败，失败原因不来自本次新增/修改文件。
- **状态**：[x]
