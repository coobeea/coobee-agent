# ASR 延迟恢复聆听 - TODO

### 1. 增加回复后 3 秒延迟恢复

- **目标**：大模型回复完成后不要立刻恢复麦克风监听。
- **涉及范围**：`src/renderer/src/components/chat/VoiceConversationInput.vue`
- **具体动作**：
  - 增加 `RESUME_LISTEN_DELAY_MS = 3000`。
  - 增加 `resumeDelayActive` 和 `resumeDelayTimer`。
  - `disabled` 变 false 时保持静音并启动延迟恢复。
- **验收标准**：
  - [x] 回复完成后延迟 3 秒自动恢复。
- **状态**：[x]

### 2. 支持手动提前恢复和清理定时器

- **目标**：延迟期间用户点击麦克风可以立即恢复；组件状态切换时不会留下旧定时器。
- **涉及范围**：`src/renderer/src/components/chat/VoiceConversationInput.vue`
- **具体动作**：
  - 点击麦克风恢复时清理延迟定时器。
  - disabled、ASR ready 状态变化和组件卸载时清理定时器。
- **验收标准**：
  - [x] 手动恢复不会再被旧定时器影响。
  - [x] 组件卸载会清理定时器。
- **状态**：[x]

### 3. 运行针对性校验

- **目标**：确保改动没有 lint 问题。
- **涉及范围**：本次修改文件。
- **具体动作**：
  - 执行 `pnpm exec eslint src/renderer/src/components/chat/VoiceConversationInput.vue`。
- **验收标准**：
  - [x] ESLint 通过。
- **状态**：[x]
