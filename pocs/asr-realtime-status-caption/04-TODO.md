# ASR 实时状态字幕 - TODO

### 1. 在服务端本地 ASR 中推送实时状态

- **目标**：让前端知道服务端已经收到语音、正在缓存或正在识别。
- **涉及范围**：`resources/workers/asr/server.py`
- **具体动作**：
  - 增加状态推送辅助函数，消息字段使用 `asr_status`。
  - 在开始检测到语音时推送 `speech_start`。
  - 语音持续过程中节流推送 `speech_active`。
  - 触发识别前推送 `recognizing`。
  - 识别返回文本后推送 `recognized`。
- **验收标准**：
  - [x] 状态消息不会和 `partial/final` 冲突。
  - [x] `speech_active` 有节流，避免每个 chunk 都发。
- **状态**：[x]

### 2. 在 `useAudioRecorder` 中解析状态消息

- **目标**：把服务端状态传给 UI 组件。
- **涉及范围**：`src/renderer/src/composables/useAudioRecorder.ts`
- **具体动作**：
  - 定义 `AsrStatusPayload` 类型。
  - 在 `AudioRecorderOptions` 中增加 `onStatus` 回调。
  - 在 WebSocket 消息处理中识别 `asr_status` 并调用回调。
- **验收标准**：
  - [x] 没有 `partial/final` 的状态消息也能被处理。
  - [x] 旧消息格式仍能正常处理。
- **状态**：[x]

### 3. 在语音输入组件展示一行实时状态字幕

- **目标**：给用户明确的“正在听/正在识别/最新文本”反馈。
- **涉及范围**：`src/renderer/src/components/chat/VoiceConversationInput.vue`
- **具体动作**：
  - 增加实时状态文本状态。
  - partial 返回时展示最新尾部文本。
  - 状态消息返回时展示对应状态。
  - UI 只显示一行，超出省略。
- **验收标准**：
  - [x] 录音过程中能看到一行处理反馈。
  - [x] 文本过长时只显示尾部或省略，不撑开输入区。
- **状态**：[x]

### 4. 运行针对性校验

- **目标**：确保改动没有语法和 lint 问题。
- **涉及范围**：本次修改文件。
- **具体动作**：
  - 执行 `python3 -m py_compile resources/workers/asr/server.py`。
  - 执行 `pnpm exec eslint src/renderer/src/composables/useAudioRecorder.ts src/renderer/src/components/chat/VoiceConversationInput.vue`。
- **验收标准**：
  - [x] 校验通过。
- **状态**：[x]
