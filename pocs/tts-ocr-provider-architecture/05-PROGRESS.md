# TTS OCR Provider 架构拆分 - 执行进度

> 创建时间：2026-05-04
> 当前状态：实施中

## 实施记录

### 2026-05-04

- 完成了需求分析、方案设计和反思优化
- 修改了文件：
  - `pocs/tts-ocr-provider-architecture/01-需求分析.md`
  - `pocs/tts-ocr-provider-architecture/02-方案设计.md`
  - `pocs/tts-ocr-provider-architecture/03-反思优化.md`
- 备注：
  - 已确认本轮目标是让 `tts`、`ocr` 按 `asr` 现有方式拆成 provider 架构
  - 当前选定方案为中策：先按各自 worker 独立落地，不额外引入共享基建

### 2026-05-04（实施前准备）

- 完成了实施级 TODO 拆解
- 修改了文件：
  - `pocs/tts-ocr-provider-architecture/04-TODO.md`
- 备注：
  - 已将 TTS 和 OCR 的拆分任务细化到可直接执行
  - 下一步先拆 `tts`，并在完成后进行自测

### 2026-05-04（TTS Provider 拆分）

- 完成了 `tts` 的 provider 架构改造
- 修改了文件：
  - `resources/workers/tts/server.py`
  - `resources/workers/tts/app/__init__.py`
  - `resources/workers/tts/app/provider_registry.py`
  - `resources/workers/tts/providers/__init__.py`
  - `resources/workers/tts/providers/base.py`
  - `resources/workers/tts/providers/local_provider.py`
  - `resources/workers/tts/providers/edge_provider.py`
  - `resources/workers/tts/providers/aliyun_qwen_provider.py`
  - `resources/workers/tts/providers/aliyun_cosyvoice_provider.py`
  - `pocs/tts-ocr-provider-architecture/04-TODO.md`
- 备注：
  - `startup`、`/health`、`/api/test`、`/api/tts`、`/ws/tts`、`/api/speakers` 已改为通过当前 provider 分发
  - 保留了现有路由协议与配置协议，不改前端设置页
  - 已通过 `python -m py_compile` 语法验证
  - 已用当前默认模型 `edge-tts` 完成一轮自测：`/health` 返回 `backend=edge-tts`，`/api/test` 返回 `ok=true`

### 2026-05-04（OCR Provider 拆分）

- 完成了 `ocr` 的 provider 架构改造
- 修改了文件：
  - `resources/workers/ocr/server.py`
  - `resources/workers/ocr/app/__init__.py`
  - `resources/workers/ocr/app/provider_registry.py`
  - `resources/workers/ocr/providers/__init__.py`
  - `resources/workers/ocr/providers/base.py`
  - `resources/workers/ocr/providers/local_provider.py`
  - `resources/workers/ocr/providers/aistudio_provider.py`
  - `pocs/tts-ocr-provider-architecture/04-TODO.md`
- 备注：
  - `startup`、`/health`、`/api/test`、`/api/ocr`、`/ws/ocr` 已改为通过当前 provider 分发
  - 本地 OCR 与 AI Studio 在线 OCR 已拆到独立 provider 文件
  - 已通过 `python -m py_compile` 语法验证
  - 按最新约束，后续只补在线 OCR 链路验证，不跑本地 OCR 模型

### 2026-05-04（OCR 在线链路验证）

- 完成了 OCR 在线 provider 的最小化运行验证
- 修改了文件：
  - `pocs/tts-ocr-provider-architecture/04-TODO.md`
  - `pocs/tts-ocr-provider-architecture/05-PROGRESS.md`
  - `pocs/tts-ocr-provider-architecture/06-BUGS.md`
- 备注：
  - 使用临时运行时配置将 `model_name` 指向 `aistudio/layout-parsing`
  - `/health` 返回 `provider=aistudio`、`model_name=layout-parsing`、`api_key_configured=false`
  - `/api/test` 已命中在线 OCR 分支，并按预期返回 `未配置 OCR API Token，请在设置中配置后再使用`
  - 说明当前 provider 架构、在线模型选择和错误路径均已打通
  - 由于当前环境没有 AI Studio Token，本轮未继续做真实在线识别

### 2026-05-04（OCR 在线实测通过）

- 完成了 OCR 在线配置的真实识别测试
- 修改了文件：
  - `/.home/workers/ocr/config.json`
  - `pocs/tts-ocr-provider-architecture/05-PROGRESS.md`
  - `pocs/tts-ocr-provider-architecture/06-BUGS.md`
- 备注：
  - 已将 `model_name` 切换为 `aistudio/layout-parsing`
  - 已将 Access Token 写入 `model_credentials["aistudio/layout-parsing"].api_key`
  - `/health` 返回 `provider=aistudio`、`api_key_configured=true`
  - `/api/test` 返回 `ok=true`，识别结果为 `OCR TEST 123`
  - 在线 OCR provider 架构、配置读取和真实识别链路均已验证通过

### 2026-05-04（TTS 在线实测通过）

- 完成了一个在线 TTS 模型的真实运行验证
- 修改了文件：
  - `pocs/tts-ocr-provider-architecture/05-PROGRESS.md`
- 备注：
  - 使用临时运行时配置将 `model_name` 指向 `aliyun/qwen3-tts-flash-realtime`
  - `/health` 返回 `backend=qwen-tts-realtime`、`model_name=qwen3-tts-flash-realtime`、`api_key_configured=true`
  - `/api/test` 返回 `ok=true`，`audio_bytes=28579`，`latency_ms=4650`
  - 说明 `tts` 的 provider 架构、按模型读取 `api_key` 和阿里云在线合成链路均已验证通过
