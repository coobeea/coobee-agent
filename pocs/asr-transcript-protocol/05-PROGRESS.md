# ASR 转写协议统一 - 执行进度

> 创建时间：2026-05-03
> 当前状态：实施中

## 实施记录

### 2026-05-03

- 完成了 ASR 协议层问题梳理，并新增 `pocs/asr-transcript-protocol/01-03` 文档沉淀需求、方案和反思。
- 修改了 `resources/workers/asr/server.py`，为本地 ASR 与阿里云 ASR 同时输出统一转写字段，并保留旧 `partial/final` 兼容消息。
- 修改了 `src/renderer/src/composables/useAudioRecorder.ts`，新增统一转写 payload 与 `onTranscriptUpdate` 回调，优先消费统一协议。
- 修改了 `src/renderer/src/views/InsightView.vue`，改为按“基线 transcript + live segment”显示，并仅同步 committed 增量到会话 transcript。
- 修改了 `src/renderer/src/components/chat/VoiceConversationInput.vue`，改为直接消费统一 `displayText`，在 turn final 时加快自动提交。
- 在 `src/renderer/src/composables/useAudioRecorder.ts` 中增加统一转写消息的 `seq` 去重保护，降低重复消息或乱序消息导致的重复展示风险。
- 在 `resources/workers/asr/server.py` 的阿里云链路中补上 `session.finished` 前草稿尾段的收尾合并，并在 `session_final` 中补齐 legacy `final` 兜底。
- 执行了 `python3 -m py_compile resources/workers/asr/server.py`，通过。
- 执行了针对 `useAudioRecorder.ts`、`InsightView.vue`、`VoiceConversationInput.vue` 的 ESLint 检查，已清理本轮新增告警。
