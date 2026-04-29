# ASR 模型路径优化 - TODO

### 1. 为 ASR Worker 增加本地模型完整性判断

- **目标**：避免把只有配置文件、权重仍在下载中的目录当作可加载模型。
- **涉及范围**：`resources/workers/asr/server.py`
- **具体动作**：
  - 增加模型权重文件后缀常量。
  - 增加检查目录内是否存在 `.pt`、`.bin`、`.safetensors`、`.onnx` 等权重文件的函数。
  - 跳过 `._____temp` 等临时目录。
- **验收标准**：
  - [x] 不完整缓存目录不会作为本地模型路径传给 `AutoModel`。
- **状态**：[x]

### 2. 为 ASR Worker 增加多候选模型路径解析

- **目标**：兼容 ModelScope 实际缓存路径和用户显式本地路径。
- **涉及范围**：`resources/workers/asr/server.py`
- **具体动作**：
  - 检查绝对路径 `model_name`。
  - 检查相对配置文件目录的路径。
  - 检查 `MODEL_DIR/<model_name>`。
  - 检查 `MODEL_DIR/models/<model_name>`。
  - 去重后按顺序返回第一个完整路径。
- **验收标准**：
  - [x] `MODEL_DIR/models/FunAudioLLM/Fun-ASR-Nano-2512` 下载完整后会被优先使用。
- **状态**：[x]

### 3. 同步健康检查中的路径诊断信息

- **目标**：让设置页或日志排查时能看到 Worker 实际使用的本地模型路径。
- **涉及范围**：`resources/workers/asr/server.py`
- **具体动作**：
  - 记录解析出的本地模型路径。
  - `/health` 返回 `resolved_model_path`。
- **验收标准**：
  - [x] 本地模型命中时 `/health` 能看到路径。
  - [x] 未命中本地模型时该字段为 `null`。
- **状态**：[x]

### 4. 验证 Python 语法

- **目标**：确保 ASR Worker 修改后至少可正常编译。
- **涉及范围**：`resources/workers/asr/server.py`
- **具体动作**：
  - 执行 `python3 -m py_compile resources/workers/asr/server.py`。
- **验收标准**：
  - [x] 编译通过。
- **状态**：[x]
