# ASR 实时状态字幕 - PROGRESS

> 创建时间：2026-04-29

## 进度记录

- 初始化需求、方案、反思和执行清单。
- 已在本地 ASR WebSocket 中新增 `asr_status` 状态消息，覆盖 `speech_start`、`speech_active`、`speech_end`、`recognizing`、`recognized`。
- 已为本地 ASR WebSocket 发送增加锁，避免状态消息和 `partial/final` 同时写入同一连接。
- 已在 `useAudioRecorder` 中增加 `AsrStatusPayload` 类型和 `onStatus` 回调。
- 已在 `VoiceConversationInput` 中增加单行实时字幕，展示服务端处理状态和最新识别尾部。
- 已执行 Python 编译、前端 ESLint 和 diff 空白检查，均通过。
