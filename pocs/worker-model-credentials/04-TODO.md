# Worker 模型密钥配置 - 待办事项

> 创建时间：2026-05-04
> 关联分支：未创建

## 状态说明

- [ ] 待处理
- [x] 已完成
- [-] 已取消

## 待办事项

### 1. 定义 Worker 新配置协议并兼容旧格式

- **目标**：让 `asr/tts/ocr` 统一使用“单一激活模型 + 按模型保存密钥”的结构。
- **涉及范围**：
  - `src/main/rpc/WorkerMethods.ts`
- **具体动作**：
  - 增加 `model_credentials` 结构的规范化逻辑
  - 将旧顶层 `api_key` 自动迁移到当前 `model_name` 对应条目
  - 清理 `api_url` 顶层写入
  - 让配置日志对嵌套密钥递归脱敏
- **验收标准**：
  - [x] `worker.configGet` 返回的新结构已包含 `model_credentials`
  - [x] `worker.configUpdate` 写入时不再保留顶层 `api_url/api_key`
- **状态**：[x]

### 2. 改造设置页以按模型保存 API Key

- **目标**：让设置页在切换模型时读取该模型自己的 API Key。
- **涉及范围**：
  - `src/renderer/src/views/settings/WorkersSettings.vue`
- **具体动作**：
  - 去掉 `api_url` 输入和保存逻辑
  - 改为读取/写入 `model_credentials[model_name].api_key`
  - 继续沿用 `model_name` 作为当前激活模型
- **验收标准**：
  - [x] 在线模型切换后显示该模型自己的密钥
  - [x] 设置页不再显示 `API 地址` 配置项
- **状态**：[x]

### 3. 同步调整 ASR/TTS/OCR Worker 的运行时配置读取

- **目标**：让三个 worker 都能识别新格式，并兼容旧格式。
- **涉及范围**：
  - `resources/workers/asr/core/config.py`
  - `resources/workers/tts/server.py`
  - `resources/workers/ocr/server.py`
- **具体动作**：
  - 优先读取 `model_credentials[model_name].api_key`
  - 保留旧顶层 `api_key` 兜底
  - 不再从运行时配置文件读取 `api_url`
- **验收标准**：
  - [x] 三个 worker 都支持新格式
  - [x] 旧格式文件仍可启动
- **状态**：[x]

### 4. 迁移当前运行时配置文件并做验证

- **目标**：让当前开发环境下的 `/.home/workers/*/config.json` 直接落到新结构。
- **涉及范围**：
  - `/.home/workers/asr/config.json`
  - `/.home/workers/tts/config.json`
  - `/.home/workers/ocr/config.json`
- **具体动作**：
  - 将现有配置改为 `model_credentials` 结构
  - 保留当前激活模型
  - 保留已保存的有效密钥
- **验收标准**：
  - [x] 三个运行时配置文件都已改成新结构
  - [x] 完成一轮语法和诊断验证
- **状态**：[x]
