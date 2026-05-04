# TTS OCR Provider 架构拆分 - 待办事项

> 创建时间：2026-05-04
> 关联分支：待定

## 状态说明

- [ ] 待处理
- [x] 已完成
- [-] 已取消

## 待办事项

### 1. 为 TTS 定义 provider 抽象和 registry 入口

- **目标**：让 `tts` 先具备和 `asr` 一样的 provider 边界，`server.py` 不再直接维护所有后端分支。
- **背景**：当前 `tts/server.py` 同时处理本地、Edge、阿里云 Qwen Realtime、CosyVoice 四类后端，分支逻辑过重。
- **涉及范围**：
  - `resources/workers/tts/server.py`
  - 新增 `resources/workers/tts/app/provider_registry.py`
  - 新增 `resources/workers/tts/providers/base.py`
- **具体动作**：
  - 定义 `BaseTtsProvider` 抽象
  - 定义 provider 注册器
  - 改造 `server.py`，通过当前模型选择 provider
- **验收标准**：
  - [x] `server.py` 中不再直接承载所有 provider 的入口分支
  - [x] `startup`、`/health`、`/api/test`、`/api/tts`、`/ws/tts` 可通过 provider 分发
- **状态**：[x]

### 2. 拆分 TTS 各 provider 实现并完成回归验证

- **目标**：将 TTS 的本地、Edge、阿里云 Qwen、CosyVoice 逻辑拆到独立 provider 文件。
- **背景**：TTS 是当前最复杂的单文件 worker，优先拆它能最大幅度降低维护成本。
- **涉及范围**：
  - `resources/workers/tts/server.py`
  - 新增 `resources/workers/tts/providers/local_provider.py`
  - 新增 `resources/workers/tts/providers/edge_provider.py`
  - 新增 `resources/workers/tts/providers/aliyun_qwen_provider.py`
  - 新增 `resources/workers/tts/providers/aliyun_cosyvoice_provider.py`
- **具体动作**：
  - 迁移各 provider 的 `startup/health/run_test/synthesize/handle_ws`
  - 保留 `/api/speakers` 的既有返回语义
  - 自测 `tts` 至少覆盖当前默认模型和一个在线模型
- **验收标准**：
  - [x] TTS 四类 provider 主体逻辑从 `server.py` 迁出
  - [x] `tts` 路由保持兼容
  - [x] 完成一轮 `tts` 自测
- **状态**：[x]

### 3. 为 OCR 定义 provider 抽象和 registry 入口

- **目标**：让 `ocr` 与 `asr/tts` 一样，拥有统一的 provider 入口层。
- **背景**：当前 `ocr/server.py` 也同时承载本地识别和 AI Studio 在线识别。
- **涉及范围**：
  - `resources/workers/ocr/server.py`
  - 新增 `resources/workers/ocr/app/provider_registry.py`
  - 新增 `resources/workers/ocr/providers/base.py`
- **具体动作**：
  - 定义 `BaseOcrProvider` 抽象
  - 定义 registry 并接入 `server.py`
  - 让 `startup`、`/health`、`/api/test`、`/api/ocr`、`/ws/ocr` 改为走 provider
- **验收标准**：
  - [x] `ocr/server.py` 中的 provider 分支显著收敛
  - [x] OCR 路由可通过 provider 分发
- **状态**：[x]

### 4. 拆分 OCR 本地与在线 provider 并完成基础验证

- **目标**：将 OCR 的本地和 AI Studio 在线能力迁入独立 provider 文件。
- **背景**：OCR 当前 provider 数量不多，但已经具备明显的“本地 / 在线”边界，适合按 `asr` 模式对齐。
- **涉及范围**：
  - `resources/workers/ocr/server.py`
  - 新增 `resources/workers/ocr/providers/local_provider.py`
  - 新增 `resources/workers/ocr/providers/aistudio_provider.py`
- **具体动作**：
  - 迁移本地 OCR 测试、识别和流式处理逻辑
  - 迁移 AI Studio 在线 OCR 调用逻辑
  - 只验证在线 OCR 链路，不跑本地模型自测
- **验收标准**：
  - [x] OCR 本地 / 在线主体逻辑从 `server.py` 迁出
  - [x] `ocr` 的 `/health`、`/api/test`、`/api/ocr`、`/ws/ocr` 保持兼容
- **状态**：[x]
