# ASR 音频按帧缓存发送 - PROGRESS

> 创建时间：2026-04-29

## 进度记录

- 初始化需求、方案、反思和执行清单。
- 已将 `useAudioRecorder` 的主发送路径改为累计满 5 个音频采集帧后立即 flush。
- 已保留 600ms 兜底 flush，用于发送不足 5 帧的尾部缓存。
- 已执行 `pnpm exec eslint src/renderer/src/composables/useAudioRecorder.ts`，检查通过。
