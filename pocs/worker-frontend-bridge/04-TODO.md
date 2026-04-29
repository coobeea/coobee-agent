# Worker 前端对接方式 - TODO

> 创建时间：2026-04-29

## 1. 新增 Worker 前端客户端目录和端点契约

- **目标**：把 ASR/TTS/OCR 的直连协议从组件中抽出来，形成统一入口。
- **背景/原因**：旧项目里 VoicePanel、useTtsPlayback、useAudioRecorder 都直接拼 Worker URL。迁移后如果继续散落在组件里，后续代理、鉴权、重连都会难维护。
- **涉及范围**：
  - `src/renderer/src/services/workers/`
  - `src/shared/events/worker.ts`
  - 可选：`src/shared/worker-protocol.ts`
- **具体动作**：
  - 新增 `getWorkerWsUrl(workerName, path)` 和 `getWorkerHttpUrl(workerName, path)`。
  - URL 构造统一依赖 `workerStore.getWorker(name)?.port` 和 `configManager.getHost()`。
  - 定义 ASR/TTS/OCR 的请求和响应类型。
  - 连接前统一校验 Worker 是否 ready。
- **非目标**：
  - 本项不改 Worker Python 服务端协议。
  - 本项不实现 Gateway 数据代理。
- **验收标准**：
  - [ ] 业务组件不再直接拼 `ws://.../ws/asr`、`ws://.../ws/tts`。
  - [ ] ASR/TTS/OCR 的请求和响应类型有集中定义。
  - [ ] Worker 未 ready 时 client 返回明确错误。
- **状态**：[ ]

## 2. 将 VoicePanel 的 ASR WebSocket 逻辑迁到 useAsrWorker

- **目标**：让 VoicePanel 只关心“开始监听、停止监听、收到文本”，不关心 Worker 端点细节。
- **背景/原因**：当前 VoicePanel 直接处理 WebSocket、PCM 发送、ASR 返回消息，职责偏重。
- **涉及范围**：
  - `src/renderer/src/components/agent/VoicePanel.vue`
  - `src/renderer/src/services/workers/useAsrWorker.ts`
- **具体动作**：
  - 抽出 ASR WebSocket 创建、关闭、错误处理。
  - 保留或抽出 PCM 降采样逻辑。
  - 提供 `connect()`、`disconnect()`、`sendPcm()`、`onPartial`、`onFinal`。
  - Worker restart 后能断开旧连接并允许重连。
- **非目标**：
  - 本项不改变 ASR Worker 的 VAD 逻辑。
- **验收标准**：
  - [ ] VoicePanel 不直接出现 `/ws/asr`。
  - [ ] ASR ready 后仍能开始麦克风监听。
  - [ ] final 文本仍能进入当前会话输入/发送流程。
- **状态**：[ ]

## 3. 补齐 TTS 播放客户端

- **目标**：恢复旧项目 `useTtsPlayback.ts` 的能力，并接入当前 Worker store。
- **背景/原因**：TTS Worker 已迁移，`/ws/tts` 已存在，但当前项目缺少旧版那种可复用的流式朗读 composable。
- **涉及范围**：
  - `src/renderer/src/services/workers/useTtsWorker.ts`
  - `src/renderer/src/composables/useTtsPlayback.ts` 或同等位置
  - 使用 TTS 的聊天/语音组件
- **具体动作**：
  - 封装 `/ws/tts` 连接。
  - 支持发送 `{ text, speaker }`。
  - 支持接收 `{ audio, format }` 并播放。
  - 支持 stop/dispose，避免音频队列泄漏。
- **非目标**：
  - 本项不新增 TTS 模型和音色管理 UI。
- **验收标准**：
  - [ ] 前端可通过统一 composable 播放 Worker 合成音频。
  - [ ] Worker 未 ready 时不会静默失败，有明确状态。
  - [ ] 切换/停止 Worker 后 TTS 连接能释放。
- **状态**：[ ]

## 4. 新增 OCR Worker 客户端

- **目标**：让 OCR Worker 有明确前端消费入口。
- **背景/原因**：OCR Worker 已提供 `POST /api/ocr` 和 `WS /ws/ocr`，但当前前端未形成统一调用方式。
- **涉及范围**：
  - `src/renderer/src/services/workers/useOcrWorker.ts`
  - 未来图片识别、文件预览或工具调用 UI
- **具体动作**：
  - 封装同步 OCR：`recognizeImage(imageBase64, task)`。
  - 封装可选 WebSocket OCR：连接 `/ws/ocr`，处理 processing/success/error。
  - 统一处理图片大小、base64 前缀、错误提示。
- **非目标**：
  - 本项不设计 OCR 的最终 UI。
- **验收标准**：
  - [ ] 前端能通过 client 调用 `/api/ocr`。
  - [ ] OCR Worker 未 ready 时返回明确错误。
  - [ ] OCR 响应类型和错误类型可被调用方识别。
- **状态**：[ ]

## 5. 为 Worker store 增加 Gateway 重连后的自动刷新

- **目标**：Gateway 重连后自动同步 Worker 状态，避免状态栏显示陈旧状态。
- **背景/原因**：旧项目 `useWorkerWs.ts` 在 Gateway reconnect 后会 `fetchWorkerList()`。
- **涉及范围**：
  - `src/renderer/src/stores/worker.ts`
  - `src/renderer/src/services/GatewayClient.ts` 或现有 `gateway.onConnect`
- **具体动作**：
  - 在 worker store 初始化时注册 `gateway.onConnect(() => requestWorkers())`。
  - 避免重复注册监听器。
  - 保留手动 `requestWorkers()`。
- **非目标**：
  - 本项不改 GatewayClient 重连策略。
- **验收标准**：
  - [ ] Gateway reconnect 后 Worker list 自动刷新。
  - [ ] 多次创建 store 不会重复注册同一事件导致多次请求。
- **状态**：[ ]

## 6. 明确 LAN/Web 访问策略

- **目标**：决定外部浏览器访问时 Worker 数据通道如何工作。
- **背景/原因**：直连 Worker 端口适合 Electron 本机；局域网访问时会遇到端口可达性和安全问题。
- **涉及范围**：
  - `src/main/common/env.ts`
  - `src/main/common/worker/WorkerManager.ts`
  - Gateway 代理方案或 Worker 鉴权方案
- **具体动作**：
  - 明确产品是否需要局域网浏览器调用 ASR/TTS/OCR。
  - 如果不需要：Worker 继续绑定 `127.0.0.1`，文档注明仅 Electron 本机可用。
  - 如果需要：评估 Gateway 代理或 Worker token。
  - 写入开发文档和配置说明。
- **非目标**：
  - 本项不立即实现代理。
- **验收标准**：
  - [ ] LAN/Web 访问是否支持 Worker 有明确结论。
  - [ ] 安全策略有文档，不再靠隐含默认值。
- **状态**：[ ]

## 7. 实现 Gateway Worker 透明反向代理第一版

- **目标**：让前端数据通道也只访问 Gateway，由 Gateway 转发到本机 Worker。
- **背景/原因**：直连 Worker 端口会让 Electron、本机浏览器、局域网浏览器三种访问模式出现不一致；同时 Worker 端口不应成为前端对外契约。
- **涉及范围**：
  - `src/main/common/gateway/GatewayServer.ts`
  - `src/main/common/gateway/Gateway.ts`
  - `src/main/common/gateway/types.ts`
  - `src/main/common/env.ts`
  - `src/main/common/worker/WorkerManager.ts`
  - `src/main/routes/WorkerProxyRoutes.ts`
  - `src/renderer/src/config.ts`
  - `src/renderer/src/components/agent/VoicePanel.vue`
- **具体动作**：
  - 为 GatewayServer 增加 WebSocket upgrade 分发能力。
  - 新增 `/gateway/workers/:name/api/*` HTTP 透明代理。
  - 新增 `/gateway/workers/:name/ws/*` WebSocket 透明代理。
  - 代理目标只允许来自 `WorkerManager` 中 `status === "ready"` 的 Worker。
  - 拆分 Gateway 绑定地址和 Worker 绑定地址，避免局域网模式下 Worker 端口一起暴露。
  - 前端新增 Worker Proxy URL 构造方法。
  - VoicePanel 的 ASR/TTS WebSocket 先切到 Gateway Proxy。
- **非目标**：
  - 本项不重构 `useAsrWorker` / `useTtsWorker`。
  - 本项不改变 Python Worker 的原有协议。
  - 本项不实现新的 Gateway 鉴权策略。
- **验收标准**：
  - [x] `/gateway/ws` 原 JSON RPC 通道仍保留。
  - [x] `ws://gateway/gateway/workers/asr/ws/asr` 可按 Worker ready 状态代理。
  - [x] `ws://gateway/gateway/workers/tts/ws/tts` 可按 Worker ready 状态代理。
  - [x] `http://gateway/gateway/workers/ocr/api/ocr` 有后端透明代理入口。
  - [x] 前端不再根据 Worker 端口拼 ASR/TTS 数据通道地址。
- **状态**：[x]
