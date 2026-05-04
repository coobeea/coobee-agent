# ASR Provider 架构拆分 - 问题记录

> 创建时间：2026-05-04

## 问题列表

### BUG-001: `server.py` 单文件职责过多，provider 扩展与排障成本高

- **发现时间**：2026-05-04
- **严重程度**：严重
- **现象**：
  - 当前 `resources/workers/asr/server.py` 同时包含启动、配置、健康检查、阿里云适配、本地识别、VAD、统一 transcript 协议、日志等多类职责
  - 阅读和修改时需要跨多个逻辑层来回切换
- **原因**：
  - 历史上先以功能落地为主，随着本地 / 在线 provider 增加，逻辑逐步堆叠到同一文件
- **解决方案**：
  - 将 `server.py` 收敛为入口层
  - 抽出 `core/` 通用层
  - 抽出 `providers/` 实现层
- **状态**：待处理

### BUG-002: 实时 transcript 协议已经统一，但 provider 组装逻辑仍然分散

- **发现时间**：2026-05-04
- **严重程度**：一般
- **现象**：
  - 本地与阿里云都能输出统一 transcript 字段
  - 但 `send_transcript_event` 仍分别定义在两套实现内部
- **原因**：
  - 协议统一先完成了字段层，尚未进一步收敛为共享 emitter
- **解决方案**：
  - 增加统一 transcript emitter 与 session context
  - 让 provider 只上报语义数据，不直接拼最终 JSON
- **状态**：待处理

### BUG-003: 阿里云链路存在“音频仍持续输入，但一段时间内不再出 transcript”的现象

- **发现时间**：2026-05-04
- **严重程度**：严重
- **现象**：
  - `worker-asr.log` 中可见后期持续出现 `[ALIYUN_AUDIO_IN]`
  - 但在部分时间窗中缺少新的 `ALIYUN_TRANSCRIPT update/turn_final`
  - 用户感知为“录到后面不出字”
- **原因**：
  - 当前仍在排查，初步判断更偏阿里云 turn/VAD 或事件产出层，而不是前端未发送音频
- **解决方案**：
  - 架构拆分后优先让阿里云 provider 独立，便于单独诊断 turn/VAD/事件转换
  - 保留并强化现有日志能力
- **状态**：待处理

### BUG-004: 前端历史上曾把实时快照流误当作增量流消费，导致重复显示风险

- **发现时间**：2026-05-04
- **严重程度**：一般
- **现象**：
  - `display_text` / `committed_text` / `draft_text` 是“当前快照”
  - 若前端按“新增文本”处理，容易重复展示
- **原因**：
  - 实时 ASR 与离线 ASR 的语义不同，前端最初容易按“追加文本”思维消费
- **解决方案**：
  - 继续坚持统一 transcript 协议
  - 后端协议层必须稳定，避免 provider 之间再产生语义偏差
- **状态**：已记录

### BUG-005: 本地模型启动日志仍出现 `download models from model hub: ms` 提示，容易误判为仍在走远程下载

- **发现时间**：2026-05-04
- **严重程度**：轻微
- **现象**：
  - 已命中本地模型路径并成功从本地 `model.pt` 加载
  - 但启动日志中仍出现 `download models from model hub: ms`
- **原因**：
  - 这是 FunASR / ModelScope 初始化日志行为，和最终是否命中本地权重不是同一个判断点
- **解决方案**：
  - 排障时以 `使用本地模型路径`、`Loading pretrained params from .../model.pt`、`resolved_model_path` 为准
  - 后续如有必要，再额外补充更明确的本地命中日志
- **状态**：已记录

### BUG-006: 本地模型验证时存在非阻塞弃用提示

- **发现时间**：2026-05-04
- **严重程度**：轻微
- **现象**：
  - 启动时出现 FastAPI `on_event` 弃用提示
  - 启动时出现 `asyncio.iscoroutinefunction` 弃用提示
- **原因**：
  - 属于框架 / 运行时 API 升级带来的提示，不影响当前本地模型跑通
- **解决方案**：
  - 后续单独收口为兼容性清理项
  - 当前不阻塞本地 ASR 功能验证
- **状态**：已记录

### BUG-007: 阿里云在线 ASR 模型并不共用同一套 WebSocket 协议

- **发现时间**：2026-05-04
- **严重程度**：一般
- **现象**：
  - `qwen3-asr-flash-realtime` 使用 `/api-ws/v1/realtime` + `session.update/input_audio_buffer.*`
  - `fun-asr-realtime` 使用 `/api-ws/v1/inference` + `run-task/result-generated/finish-task`
  - 如果只在模型列表中新增选项而不补协议分支，切换后会直接不可用
- **原因**：
  - 阿里云百炼“在线 ASR”在产品层看似同类，但底层接入协议并未统一
- **解决方案**：
  - 在 `aliyun_provider.py` 中按模型协议分流
  - 在 `core/config.py` 中按模型名自动选择默认 `api_url`
- **状态**：已记录
