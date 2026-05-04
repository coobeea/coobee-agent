# Worker 模型密钥配置 - 执行进度

> 创建时间：2026-05-04
> 当前状态：已完成

## 实施记录

### 2026-05-04

- 完成了 Worker 配置新协议设计，确定保留 `model_name`，新增 `model_credentials`
- 修改了 `src/main/rpc/WorkerMethods.ts`
- 修改了 `src/renderer/src/views/settings/WorkersSettings.vue`
- 修改了 `resources/workers/asr/core/config.py`
- 修改了 `resources/workers/tts/server.py`
- 修改了 `resources/workers/ocr/server.py`
- 修改了 `/.home/workers/asr/config.json`
- 修改了 `/.home/workers/tts/config.json`
- 修改了 `/.home/workers/ocr/config.json`
- 完成了 Python 语法编译与前端诊断检查
- 完成了按 `WORKER_CONFIG_PATH` 读取新结构配置的验证
- 完成了在线 ASR 双协议实测验证：
  - `qwen3-asr-flash-realtime`
    - `/health` 返回 `model_name=qwen3-asr-flash-realtime`
    - `/api/test` 返回成功，事件序列为 `session.created -> session.updated -> session.finished`
  - `fun-asr-realtime`
    - `/health` 返回 `model_name=fun-asr-realtime`
    - `/api/test` 返回成功，事件序列为 `task-started -> result-generated -> task-finished`
- 验证确认：
  - 新配置格式 `model_credentials[model_name].api_key` 可被在线 ASR 正确读取
  - `qwen3-asr-flash-realtime` 自动解析到 `wss://dashscope.aliyuncs.com/api-ws/v1/realtime`
  - `fun-asr-realtime` 自动解析到 `wss://dashscope.aliyuncs.com/api-ws/v1/inference`
- 测试环境补充：
  - 当前终端存在 SOCKS 代理环境，真实 WebSocket 会话测试需要安装 `python-socks`
