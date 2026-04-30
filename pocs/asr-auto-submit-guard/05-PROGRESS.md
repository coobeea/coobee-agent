# ASR 自动提交保护 - PROGRESS

> 创建时间：2026-04-29

## 进度记录

- 初始化需求、方案、反思和执行清单。
- 已在 `useAudioRecorder` 增加 `speechHoldDuration`，将前端 speaking 保持时间从 text-idle 中拆出。
- 已将 `VoiceConversationInput` 中的 `partial/final/onSilence` 改为更新待发送文本并触发提交检查，不再直接发送。
- 已新增 3500ms 文本稳定窗口、1500ms 最近说话保护窗口，以及服务端识别忙碌保护窗口。
- 已在实际发送后调用 `recorder.resetSentOffset()`，减少同一轮 ASR 累计文本重复发送风险。
- 已执行 ESLint 和 diff 空白检查，均通过。
- 已增加 ASR 文本智能合并：兼容累计返回和分段返回，避免后一段覆盖前一段。
- 已把识别内容展示移动到状态说明行，替换原“停顿一会后会自动发送”的位置，并移除独立字幕行。
