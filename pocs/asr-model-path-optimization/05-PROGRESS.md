# ASR 模型路径优化 - PROGRESS

> 创建时间：2026-04-29

## 进度记录

- 初始化需求、方案、反思和执行清单。
- 已在 ASR Worker 中增加本地模型候选路径解析，支持 `MODEL_DIR/models/<org>/<model>` 的 ModelScope 缓存结构。
- 已增加权重文件完整性判断，当前只有配置文件、权重仍在 `._____temp` 的目录不会被当成本地模型使用。
- 已让 `/health` 返回 `resolved_model_path`，方便后续确认实际使用的模型路径。
- 已在首次下载完成后再次解析本地路径，避免第一次启动下载成功但健康检查仍显示空路径。
- 已执行 `python3 -m py_compile resources/workers/asr/server.py`，语法编译通过。
