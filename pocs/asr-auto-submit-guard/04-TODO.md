# ASR 自动提交保护 - TODO

### 1. 拆分前端 speaking 保持时间

- **目标**：避免 `isSpeaking` 复用 10000ms text-idle 时间，导致自动提交保护无法准确判断最近说话。
- **涉及范围**：`src/renderer/src/composables/useAudioRecorder.ts`
- **具体动作**：
  - 增加 `speechHoldDuration` 选项。
  - 前端 VAD 的 speaking 复位使用 `speechHoldDuration`。
  - 保持 text-idle 的 `silenceDuration` 不变。
- **验收标准**：
  - [x] `isSpeaking` 可在较短保护窗口后复位。
- **状态**：[x]

### 2. 将识别结果改为待发送缓冲

- **目标**：收到 `partial/final` 不再直接发送给聊天。
- **涉及范围**：`src/renderer/src/components/chat/VoiceConversationInput.vue`
- **具体动作**：
  - `onPartialResult` 更新待发送文本并调度延迟提交。
  - `onFinalResult` 更新待发送文本并调度延迟提交。
  - `onSilence` 不直接发送，只触发提交检查。
- **验收标准**：
  - [x] `final` 不会绕过前端保护直接发送。
  - [x] partial 文本稳定后也不会立即发送。
- **状态**：[x]

### 3. 增加自动提交保护判断

- **目标**：只有用户真正停顿一段时间后才自动发送。
- **涉及范围**：`src/renderer/src/components/chat/VoiceConversationInput.vue`
- **具体动作**：
  - 增加 `AUTO_SUBMIT_IDLE_MS = 3500`。
  - 增加 `RECENT_SPEECH_GRACE_MS = 1500`。
  - 跟踪最近说话时间和服务端识别忙碌窗口。
  - 提交前检查 disabled、muted、isSpeaking、最近说话、服务端忙碌状态。
- **验收标准**：
  - [x] 用户中间短暂停顿不会立即发送。
  - [x] 停顿足够久后仍会自动发送。
- **状态**：[x]

### 4. 运行针对性校验

- **目标**：确保本次改动通过 lint。
- **涉及范围**：本次修改文件。
- **具体动作**：
  - 执行 `pnpm exec eslint src/renderer/src/composables/useAudioRecorder.ts src/renderer/src/components/chat/VoiceConversationInput.vue`。
- **验收标准**：
  - [x] ESLint 通过。
- **状态**：[x]

### 5. 合并多次 ASR 返回的待发送文本

- **目标**：避免服务端多次返回识别内容时，前端用后一段覆盖前一段，造成展示和发送内容不连贯。
- **涉及范围**：`src/renderer/src/components/chat/VoiceConversationInput.vue`
- **具体动作**：
  - 增加识别文本合并函数。
  - 如果服务端返回累计文本，使用更完整的新文本。
  - 如果服务端返回分段文本，按首尾重叠部分拼接。
  - 避免完全重复片段重复追加。
- **验收标准**：
  - [x] 累计返回不会重复拼接。
  - [x] 分段返回不会覆盖已有待发送文本。
- **状态**：[x]

### 6. 将实时识别内容移到状态说明行展示

- **目标**：把原“停顿一会后会自动发送”的位置改为展示识别内容或处理状态，避免额外增加一行字幕导致位置不符合预期。
- **涉及范围**：`src/renderer/src/components/chat/VoiceConversationInput.vue`
- **具体动作**：
  - `statusDetail` 优先展示 `liveCaptionText`。
  - 移除单独的 `voice-live-caption` 行。
  - 为状态说明行增加 active/processing/recognized 颜色状态。
- **验收标准**：
  - [x] 识别内容显示在原状态说明行。
  - [x] 不再额外渲染独立字幕行。
- **状态**：[x]
