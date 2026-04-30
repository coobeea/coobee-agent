# ASR 音频按帧缓存发送 - TODO

### 1. 将 `useAudioRecorder` 的发送主路径改为满 5 帧 flush

- **目标**：让音频发送节奏跟采集帧对齐。
- **涉及范围**：`src/renderer/src/composables/useAudioRecorder.ts`
- **具体动作**：
  - 增加 `framesPerFlush` 选项，默认值为 5。
  - 每次 `onaudioprocess` 缓存一帧后检查缓存帧数。
  - 当缓存帧数达到阈值时立即调用 `flushBuffer()`。
- **验收标准**：
  - [x] 不再依赖 250ms 定时器作为主发送路径。
  - [x] 默认累计满 5 帧后发送一次 PCM。
- **状态**：[x]

### 2. 保留尾帧兜底 flush

- **目标**：避免不足 5 帧的尾部音频长期留在缓存中。
- **涉及范围**：`src/renderer/src/composables/useAudioRecorder.ts`
- **具体动作**：
  - 将原 `250ms` 定时发送改成兜底 flush。
  - 停止录音时继续 flush 剩余缓存。
- **验收标准**：
  - [x] 录音持续时不足 5 帧的尾部缓存会被兜底发送。
  - [x] 停止录音时剩余缓存会被处理。
- **状态**：[x]

### 3. 验证代码质量

- **目标**：确保修改没有引入 lint 问题。
- **涉及范围**：`src/renderer/src/composables/useAudioRecorder.ts`
- **具体动作**：
  - 执行 `pnpm exec eslint src/renderer/src/composables/useAudioRecorder.ts`。
- **验收标准**：
  - [x] ESLint 通过。
- **状态**：[x]
