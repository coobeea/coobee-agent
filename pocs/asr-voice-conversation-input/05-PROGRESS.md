# ASR 语音对话输入区 - PROGRESS

> 创建时间：2026-04-29

## 2026-04-29

- 初始化需求分析、方案设计、反思优化和执行 TODO。
- 选定新增通用 `VoiceConversationInput.vue` 并由 `ChatComposer` 切换的方案。
- 新增 `src/renderer/src/components/chat/VoiceConversationInput.vue`，支持 ASR Worker 状态、麦克风监听、静音、partial 展示和 final 文本发送。
- 更新 `ChatComposer.vue`，在 `asrEnabled` 为 true 时渲染语音对话输入区，不再显示普通文本输入框。
- 相关文件 ESLint 通过；全量 `vue-tsc` 仍受仓库既有类型错误影响。
- 增强录音过程展示：加入实时音量条、录音时长和暂停态展示，提升语音输入反馈。
