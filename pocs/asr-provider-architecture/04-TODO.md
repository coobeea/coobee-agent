# ASR Provider 架构拆分 - 待办事项

> 创建时间：2026-05-04
> 关联分支：待定

## 状态说明

- [ ] 待处理
- [x] 已完成
- [-] 已取消

## 待办事项

### 1. 抽离 ASR Worker 通用配置与公共工具模块

- **目标**：把当前 `server.py` 中与 provider 无关的配置读取、文本 merge、通用发送等逻辑迁移到独立模块，先建立后续拆分的公共地基。
- **背景**：当前本地 ASR 与阿里云 ASR 虽然实现不同，但共用了一部分配置、日志、文本拼接和 WebSocket 发送能力。如果不先抽公共层，后续 provider 拆分时容易把同一段逻辑复制两份。
- **涉及范围**：
  - `resources/workers/asr/server.py`
  - 新增 `resources/workers/asr/core/config.py`
  - 新增 `resources/workers/asr/core/transcript.py`
  - 新增 `resources/workers/asr/core/logging_utils.py`
  - 新增 `resources/workers/asr/core/ws_utils.py`
- **具体动作**：
  - 抽离模型配置、API Key、日志开关等配置读取逻辑
  - 抽离 `merge_transcript_text`、`find_text_overlap`、`get_text_tail` 等 transcript 通用函数
  - 抽离 `safe_send_json` 等 WebSocket 通用发送能力
  - 保证 `server.py` 仍然通过这些公共模块运行，不改变现有外部协议
- **非目标**：
  - 本项不拆 provider 文件
  - 本项不修改前端消费逻辑
- **验收标准**：
  - [x] `server.py` 中的公共工具函数明显减少
  - [x] 公共逻辑已进入 `core/` 目录，并可被本地 / 阿里云实现同时引用
  - [x] `/ws/asr` 对外协议字段保持不变
- **状态**：[x]

### 2. 定义统一的 Provider 抽象与注册入口

- **目标**：建立“入口层选择 provider、provider 自己处理会话”的最小抽象，避免后续继续用 if/else 把所有平台堆回 `server.py`。
- **背景**：当前 `asr_stream()` 直接判断 `USE_ALIYUN_QWEN_ASR` 后进入不同大函数，结构仍然是“分支式实现”，不利于继续扩展。
- **涉及范围**：
  - `resources/workers/asr/server.py`
  - 新增 `resources/workers/asr/providers/base.py`
  - 新增 `resources/workers/asr/app/provider_registry.py`
- **具体动作**：
  - 定义 `BaseAsrProvider` 或等价接口，至少包含 `startup()`、`health()`、`handle_ws()`
  - 定义 provider 注册与选择逻辑，根据当前配置返回本地或阿里云实现
  - 改造 `server.py` 中的 `/ws/asr`、`startup`、`health` 入口，让它们通过 provider 对象工作
- **非目标**：
  - 本项不实现新的第三方 provider
  - 本项不改变现有路由路径
- **验收标准**：
  - [x] `server.py` 中不再直接包含 provider 分支的大段实现
  - [x] provider 选择逻辑集中在单独模块中
  - [x] 后续新增 provider 时不需要在多个位置重复添加判断
- **状态**：[x]

### 3. 拆分阿里云实时 ASR 实现到独立 provider 文件

- **目标**：把阿里云实时识别链路从 `server.py` 中完整迁出，形成独立、可单独排障的 provider 实现。
- **背景**：当前“后面不出字”的问题主要发生在阿里云链路，必须让阿里云逻辑具备独立文件边界，后续才能单独调试 turn/VAD/事件转换。
- **涉及范围**：
  - `resources/workers/asr/server.py`
  - 新增 `resources/workers/asr/providers/aliyun_provider.py`
  - `resources/workers/asr/core/*` 公共模块
- **具体动作**：
  - 将 `build_aliyun_realtime_url`、连接函数、事件转换、音频转发、会话关闭逻辑迁移到 `aliyun_provider.py`
  - 保留现有日志标签，例如 `[ALIYUN_AUDIO_IN]`、`[ALIYUN_EVENT]`、`[ALIYUN_TRANSCRIPT]`、`[ALIYUN_SESSION]`
  - 通过统一 transcript emitter 输出协议，避免迁移后字段语义发生变化
- **非目标**：
  - 本项不解决阿里云识别准确率问题
  - 本项不调整阿里云 turn detection 策略
- **验收标准**：
  - [x] 阿里云链路实现主体不再出现在 `server.py`
  - [x] 现有日志标签和统一 transcript 协议保持一致
  - [x] 运行阿里云模式时行为与迁移前保持兼容
- **状态**：[x]

### 4. 拆分本地 ASR + VAD 实现到独立 provider 文件

- **目标**：把本地 ASR 的 VAD、缓冲、识别、状态输出逻辑迁移到单独文件，形成与阿里云并列的 provider 结构。
- **背景**：本地 ASR 与阿里云实现完全不同，一个是“本地 VAD + 本地识别”，一个是“云端事件流转换”。两者放在同一文件里长期维护成本很高。
- **涉及范围**：
  - `resources/workers/asr/server.py`
  - 新增 `resources/workers/asr/providers/local_provider.py`
  - 可能新增 `resources/workers/asr/core/audio_utils.py`
- **具体动作**：
  - 将本地音频缓冲、VAD 状态判断、`transcribe_async` 调用和 transcript 输出迁移到 `local_provider.py`
  - 保留现有日志标签，例如 `[AUDIO_IN]`、`[VAD]`、`[RECOGNIZE]`、`[TRANSCRIPT]`
  - 确保本地 provider 与阿里云 provider 共用统一协议输出层
- **非目标**：
  - 本项不优化本地识别模型性能
  - 本项不更换本地识别引擎
- **验收标准**：
  - [x] 本地 ASR 主体逻辑从 `server.py` 迁出
  - [x] 本地链路日志和协议输出保持兼容
  - [x] `/ws/asr` 走本地模式时行为不变
- **状态**：[x]

### 5. 为统一 transcript 输出建立独立 emitter 与 session context

- **目标**：把 transcript 序号、turn_id、revision、committed/draft/display 的组装收敛成一个统一模块，杜绝 provider 各自拼消息。
- **背景**：当前本地和阿里云各自内部都有 `send_transcript_event`，字段很像，但仍然分散在两个函数里。后续继续增加 provider 时，最容易再次出现协议漂移。
- **涉及范围**：
  - 新增 `resources/workers/asr/core/protocol.py`
  - 新增 `resources/workers/asr/core/context.py`
  - `resources/workers/asr/providers/local_provider.py`
  - `resources/workers/asr/providers/aliyun_provider.py`
- **具体动作**：
  - 定义统一 session context，保存 `committed_text`、`current_turn_id`、`revision`、`transcript_seq`
  - 定义统一 transcript emitter，负责组装标准字段与日志
  - provider 实现只提交语义数据，不自行拼装最终 JSON 结构
- **非目标**：
  - 本项不新增新的协议字段
  - 本项不变更前端字段命名
- **验收标准**：
  - [x] 本地 / 阿里云不再各自维护一套 transcript 组装逻辑
  - [x] transcript 协议字段只在一个公共模块中定义和生成
  - [x] 统一协议日志输出位置收敛
- **状态**：[x]

### 6. 补充迁移后的验证清单与回归检查

- **目标**：在拆分后快速验证“能启动、能收音频、能出 transcript、能排障”，降低重构引入行为回退的风险。
- **背景**：当前 ASR 已经存在“重复显示”和“后面不出字”的问题，架构重构不能掩盖原有问题，更不能新增入口级故障。
- **涉及范围**：
  - `resources/workers/asr/server.py`
  - `resources/workers/asr/providers/*`
  - `logs/worker-asr.log`
  - 相关 POC 文档
- **具体动作**：
  - 制定阿里云模式验证项：启动、收音频、出 `update`、出 `turn_final`、会话关闭
  - 制定本地模式验证项：启动、VAD、识别、状态输出、会话关闭
  - 制定协议一致性验证项：字段、日志、seq、turn_id、revision
  - 在 `05-PROGRESS.md` 记录每步迁移和验证结果
- **非目标**：
  - 本项不解决所有识别体验问题
  - 本项不做 UI 层联调修复
- **验收标准**：
  - [x] 拆分后两类 provider 都能正常跑通基本流程
  - [x] 日志可继续用于定位“音频到了没、识别出了没、前端收到没”
  - [x] 已形成清晰的手动回归检查清单
- **状态**：[x]
