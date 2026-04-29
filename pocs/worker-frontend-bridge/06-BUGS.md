# Worker 前端对接方式 - BUGS

> 创建时间：2026-04-29

## 已知问题

### 1. 局域网 Web 访问与 Worker 直连存在冲突

- **现象**：前端外部浏览器访问时会使用 `location.hostname` 构造 Worker URL，但 Worker 默认可能只绑定 `127.0.0.1`。
- **影响**：外部浏览器无法连接 `ws://局域网IP:{workerPort}/ws/asr` 等端点。
- **状态**：已通过 Gateway Worker Proxy 第一版缓解。
- **建议**：数据通道统一走 `/gateway/workers/:name/*`；如果 Gateway 后续暴露到局域网，还需要补充 token 或同源校验策略。

### 2. OCR Worker 已有端点但前端没有统一消费入口

- **现象**：Worker 提供 `/api/ocr` 和 `/ws/ocr`，但当前前端没有统一 OCR client。
- **影响**：后续 OCR UI 或工具消费可能重复拼 URL。
- **状态**：待实现。
- **建议**：新增 `useOcrWorker`。

### 3. VoicePanel 仍直接拼 ASR/TTS WebSocket URL

- **现象**：`VoicePanel.vue` 中仍直接持有 ASR/TTS WebSocket 生命周期和协议路径。
- **影响**：后续改鉴权、重连或 Worker 协议时仍会改组件。
- **状态**：已改为 Gateway Proxy URL，但尚未抽出 composable。
- **建议**：迁到 `useAsrWorker` 和 `useTtsWorker`。

## 阻塞问题

暂无。
