# ASR 转写协议统一 - TODO

> 创建时间：2026-05-03
> 关联分支：当前工作区

## 状态说明

- [ ] 待处理
- [x] 已完成
- [-] 已取消

## 待办事项

### 1. 在 ASR Worker 中输出统一转写协议字段

- **目标**：让本地 ASR 和阿里云 ASR 都能输出相同语义的转写消息。
- **背景**：原有 `partial/final` 在不同 provider 上含义不一致，前端无法稳定消费。
- **涉及范围**：
  - `resources/workers/asr/server.py`
- **具体动作**：
  - 为本地 ASR 增加 `transcript_event`、`provider`、`committed_text`、`draft_text`、`display_text`、`turn_id`、`revision`、`seq`、`is_final_turn`、`is_final_session`
  - 为阿里云 ASR 适配层输出同样字段
  - 保留旧 `partial/final` 兼容字段，避免灰度阶段断链
- **验收标准**：
  - [x] 本地 ASR 能输出统一字段
  - [x] 阿里云 ASR 能输出统一字段
  - [x] 旧 `partial/final` 仍保留
- **状态**：[x]

### 2. 改造 `useAudioRecorder.ts` 为统一协议消费者

- **目标**：让前端录音 composable 直接消费统一转写语义，而不是依赖长度截断。
- **背景**：当前 `sentTextLength + substring()` 的做法只在特定 provider 语义下勉强成立。
- **涉及范围**：
  - `src/renderer/src/composables/useAudioRecorder.ts`
- **具体动作**：
  - 增加统一转写 payload 类型
  - 新增 `onTranscriptUpdate` 回调
  - 优先解析统一字段，旧 `partial/final` 作为兜底
  - 保留文本 offset 机制，兼容多轮发送与分析后续录入
- **验收标准**：
  - [x] 新协议消息能被解析成统一 payload
  - [x] 旧协议消息仍能走原回调
  - [x] `resetSentOffset()` 仍可工作
- **状态**：[x]

### 3. 接入 Insight 与语音对话两个前端入口

- **目标**：让两个主要实时录音入口都使用统一协议消费。
- **背景**：协议层如果只改一半，页面还会继续保留旧的脆弱逻辑。
- **涉及范围**：
  - `src/renderer/src/views/InsightView.vue`
  - `src/renderer/src/components/chat/VoiceConversationInput.vue`
- **具体动作**：
  - `InsightView` 改为展示“基线 transcript + 当前 live segment”，并仅对 committed 增量落库
  - `VoiceConversationInput` 改为直接消费统一 `displayText`，在 turn final 时触发更快提交
- **验收标准**：
  - [x] `InsightView` 不再依赖 `lastPartialLength`
  - [x] `VoiceConversationInput` 能直接消费统一协议
  - [x] 页面布局无需改动
- **状态**：[x]

### 4. 做真实录音链路联调和边界验证

- **目标**：验证协议改造在真实麦克风和不同 provider 下的行为是否稳定。
- **背景**：当前已完成静态实现与编译校验，但还需要真实录音行为验证。
- **涉及范围**：
  - 本地 ASR
  - 阿里云 ASR
  - `InsightView.vue`
  - `VoiceConversationInput.vue`
- **具体动作**：
  - 验证草稿实时展示、turn final 提交、session final 收尾
  - 验证暂停、恢复、静音、分析后继续录音的边界
  - 观察是否仍存在重复、漏字、空格拼接异常
- **验收标准**：
  - [ ] 两个入口在真实录音下表现稳定
  - [ ] 本地与阿里云 provider 的展示行为基本一致
  - [ ] 未发现新的重复追加或漏字问题
- **状态**：[ ]
