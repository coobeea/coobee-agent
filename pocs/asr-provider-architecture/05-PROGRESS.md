# ASR Provider 架构拆分 - 执行进度

> 创建时间：2026-05-04
> 当前状态：实施中

## 实施记录

### 2026-05-04

- 完成了架构拆分需求分析与方案设计
- 修改了文件：
  - `pocs/asr-provider-architecture/01-需求分析.md`
  - `pocs/asr-provider-architecture/02-方案设计.md`
  - `pocs/asr-provider-architecture/03-反思优化.md`
- 备注：
  - 已确认当前 `server.py` 需要从单文件多职责实现，演进为“单入口 + 通用协议层 + provider 分文件实现”
  - 当前选定方案为中策：先拆 provider 文件和通用层，不一次引入过重的插件化框架

### 2026-05-04（实施前准备）

- 完成了实施级 TODO 拆解
- 修改了文件：
  - `pocs/asr-provider-architecture/04-TODO.md`
- 备注：
  - TODO 已细化到可直接执行的粒度
  - 还未开始改动 `resources/workers/asr/server.py` 和 provider 实现文件

### 2026-05-04（第一步拆分）

- 完成了通用配置、日志、transcript 工具和 WebSocket 发送能力的抽离
- 修改了文件：
  - `resources/workers/asr/server.py`
  - `resources/workers/asr/core/__init__.py`
  - `resources/workers/asr/core/config.py`
  - `resources/workers/asr/core/logging_utils.py`
  - `resources/workers/asr/core/transcript.py`
  - `resources/workers/asr/core/ws_utils.py`
  - `pocs/asr-provider-architecture/04-TODO.md`
- 备注：
  - `server.py` 已开始瘦身，并改为引用新的 `core/` 公共模块
  - 当前仍保持单入口和现有本地 / 阿里云行为不变
  - 已通过 `python -m py_compile` 验证新模块和 `server.py` 基础导入正确

### 2026-05-04（第二步拆分）

- 完成了 provider 抽象、provider 目录和 registry 接入
- 修改了文件：
  - `resources/workers/asr/server.py`
  - `resources/workers/asr/app/__init__.py`
  - `resources/workers/asr/app/provider_registry.py`
  - `resources/workers/asr/providers/__init__.py`
  - `resources/workers/asr/providers/base.py`
  - `resources/workers/asr/providers/local_provider.py`
  - `resources/workers/asr/providers/aliyun_provider.py`
  - `pocs/asr-provider-architecture/04-TODO.md`
- 备注：
  - `startup`、`health`、`/api/test`、`/ws/asr` 已改为通过当前 provider 对象分发
  - 现阶段 provider 文件仍以适配器方式接管入口，阿里云 / 本地内部主体逻辑还在 `server.py`
  - 已通过 `python -m py_compile` 验证 provider 化后的入口编排可正常导入

### 2026-05-04（第三步拆分）

- 完成了阿里云实时 ASR 主体逻辑迁移
- 修改了文件：
  - `resources/workers/asr/server.py`
  - `resources/workers/asr/providers/aliyun_provider.py`
  - `pocs/asr-provider-architecture/04-TODO.md`
- 备注：
  - 阿里云的 URL 构造、WebSocket 连接、测试会话、事件转写、音频转发和会话关闭逻辑已迁入 `aliyun_provider.py`
  - `server.py` 不再直接维护阿里云会话主体逻辑
  - 已通过 `python -m py_compile` 验证迁移后的导入与语法

### 2026-05-04（第四步拆分）

- 完成了本地 ASR + VAD 主体逻辑迁移
- 修改了文件：
  - `resources/workers/asr/server.py`
  - `resources/workers/asr/providers/local_provider.py`
  - `pocs/asr-provider-architecture/04-TODO.md`
- 备注：
  - 本地的健康检查、测试入口、VAD、识别循环和 transcript/status 下发逻辑已迁入 `local_provider.py`
  - `server.py` 当前主要保留模型加载、基础转写函数和应用入口
  - 已通过 `python -m py_compile` 验证迁移后的导入与语法

### 2026-05-04（第五步拆分）

- 完成了统一 transcript context 与 emitter 收敛
- 修改了文件：
  - `resources/workers/asr/core/context.py`
  - `resources/workers/asr/core/protocol.py`
  - `resources/workers/asr/providers/aliyun_provider.py`
  - `resources/workers/asr/providers/local_provider.py`
  - `pocs/asr-provider-architecture/04-TODO.md`
- 备注：
  - 新增 `TranscriptSessionContext`，统一维护 `committed_text`、`current_turn_id`、`revision`、`transcript_seq`
  - 新增 `TranscriptEmitter`，统一组装 transcript 协议字段与日志输出
  - 阿里云和本地 provider 不再各自维护独立的 transcript 拼包逻辑
  - 已通过 `python -m py_compile` 验证协议收敛后的导入与语法

### 2026-05-04（第六步验证）

- 完成了本地 Fun-ASR-Nano-2512 模型链路验证
- 修改了文件：
  - `pocs/asr-provider-architecture/04-TODO.md`
  - `pocs/asr-provider-architecture/05-PROGRESS.md`
  - `pocs/asr-provider-architecture/06-BUGS.md`
- 备注：
  - 已将 `/Users/lifeng/data/models/models/FunAudioLLM/Fun-ASR-Nano-2512` 同步到开发态模型目录 `/.home/models/models/FunAudioLLM/Fun-ASR-Nano-2512`
  - 使用 `MODEL_DIR=/Users/lifeng/git/git-coobee/coobee-agent/.home/models` 启动 `resources/workers/asr/server.py`
  - 日志确认命中本地模型路径：`/.home/models/models/FunAudioLLM/Fun-ASR-Nano-2512`
  - `/health` 返回 `provider=local`、`model_loaded=true`、`resolved_model_path` 正确
  - `/api/test` 返回 `ok=true`，本地推理链路完成，`inference_latency_ms≈1905ms`
