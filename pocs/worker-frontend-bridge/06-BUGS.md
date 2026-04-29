# Worker 前端对接方式 - BUGS

> 创建时间：2026-04-29

## 已知问题

### 1. 局域网 Web 访问与 Worker 直连存在冲突

- **现象**：前端外部浏览器访问时会使用 `location.hostname` 构造 Worker URL，但 Worker 默认可能只绑定 `127.0.0.1`。
- **影响**：外部浏览器无法连接 `ws://局域网IP:{workerPort}/ws/asr` 等端点。
- **状态**：待产品决策。
- **建议**：如果要支持局域网 Web 访问，优先评估 Gateway 代理或 Worker token。

### 2. OCR Worker 已有端点但前端没有统一消费入口

- **现象**：Worker 提供 `/api/ocr` 和 `/ws/ocr`，但当前前端没有统一 OCR client。
- **影响**：后续 OCR UI 或工具消费可能重复拼 URL。
- **状态**：待实现。
- **建议**：新增 `useOcrWorker`。

### 3. VoicePanel 仍直接拼 ASR/TTS WebSocket URL

- **现象**：`VoicePanel.vue` 中仍直接出现 `/ws/asr` 和 `/ws/tts`。
- **影响**：后续改代理、鉴权或路径时需要改组件。
- **状态**：待重构。
- **建议**：迁到 `useAsrWorker` 和 `useTtsWorker`。

## 阻塞问题

暂无。
