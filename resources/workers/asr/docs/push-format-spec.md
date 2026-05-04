# ASR 推送数据格式规范

> 所有 ASR Provider（local、aliyun 等）必须遵循此统一推送格式规范。

## 1. 消息类型

ASR Worker 向客户端推送三种类型的 transcript 事件：

| 事件类型        | 说明           | 触发时机                     |
| --------------- | -------------- | ---------------------------- |
| `update`        | 识别中（草稿） | 实时识别过程中，文本持续更新 |
| `turn_final`    | 单轮识别完成   | VAD 检测到语音停顿/结束      |
| `session_final` | 会话结束       | WebSocket 连接关闭时         |

## 2. 标准消息格式

### 2.1 基础字段（所有事件必须包含）

```json
{
  "transcript_event": "update | turn_final | session_final",
  "provider": "local | aliyun",
  "seq": 1,
  "turn_id": "turn-1",
  "revision": 1,
  "committed_text": "已确认的文本",
  "draft_text": "草稿文本",
  "display_text": "完整显示文本",
  "is_final_turn": true,
  "is_final_session": false
}
```

**字段说明**：

| 字段               | 类型           | 说明                                                |
| ------------------ | -------------- | --------------------------------------------------- |
| `transcript_event` | string         | 事件类型：`update` / `turn_final` / `session_final` |
| `provider`         | string         | Provider 名称：`local` / `aliyun`                   |
| `seq`              | number         | 消息序列号（会话内递增）                            |
| `turn_id`          | string \| null | 轮次 ID（如 `turn-1`），update 事件可能为 null      |
| `revision`         | number         | 版本号（同一轮次内每次更新递增）                    |
| `committed_text`   | string         | 已确认的文本（历史累积）                            |
| `draft_text`       | string         | 当前草稿文本（仅 update 事件有值）                  |
| `display_text`     | string         | 完整显示文本 = committed_text + draft_text          |
| `is_final_turn`    | boolean        | 是否为轮次最终结果                                  |
| `is_final_session` | boolean        | 是否为会话最终结果                                  |

### 2.2 兼容字段（可选）

为了兼容旧版前端，提供以下字段：

| 字段      | 类型   | 说明                            | 何时包含                        |
| --------- | ------ | ------------------------------- | ------------------------------- |
| `partial` | string | 兼容字段（等同于 draft_text）   | update 事件                     |
| `final`   | string | 兼容字段（等同于 display_text） | turn_final / session_final 事件 |

### 2.3 扩展字段（可选）

Provider 可以添加额外的元数据：

```json
{
  "latency_ms": 123,
  "lang": "zh",
  "emotion": "NEUTRAL",
  "event": "Speech"
}
```

| 字段         | 类型   | 说明                            | Provider           |
| ------------ | ------ | ------------------------------- | ------------------ |
| `latency_ms` | number | 识别延迟（毫秒）                | 所有               |
| `lang`       | string | 语言代码（zh/en/yue/ja/ko）     | local (SenseVoice) |
| `emotion`    | string | 情感（NEUTRAL/HAPPY/SAD/ANGRY） | local (SenseVoice) |
| `event`      | string | 声音事件（Speech/BGM/Laughter） | local (SenseVoice) |

## 3. 各事件类型的消息示例

### 3.1 update 事件（识别中）

```json
{
  "transcript_event": "update",
  "provider": "aliyun",
  "seq": 5,
  "turn_id": "turn-3",
  "revision": 2,
  "committed_text": "你好，",
  "draft_text": "这是识别中的文本",
  "display_text": "你好，这是识别中的文本",
  "is_final_turn": false,
  "is_final_session": false,
  "partial": "这是识别中的文本"
}
```

**特点**：

- `draft_text` 有值（正在识别的文本）
- `is_final_turn` = false
- `partial` 字段兼容旧版前端

### 3.2 turn_final 事件（单轮完成）

```json
{
  "transcript_event": "turn_final",
  "provider": "aliyun",
  "seq": 6,
  "turn_id": "turn-3",
  "revision": 3,
  "committed_text": "你好，这是识别中的文本",
  "draft_text": "",
  "display_text": "你好，这是识别中的文本",
  "is_final_turn": true,
  "is_final_session": false,
  "final": "你好，这是识别中的文本",
  "latency_ms": 150
}
```

**特点**：

- `draft_text` = ""（无草稿）
- `committed_text` 包含完整文本
- `is_final_turn` = true
- `final` 字段兼容旧版前端

### 3.3 session_final 事件（会话结束）

```json
{
  "transcript_event": "session_final",
  "provider": "local",
  "seq": 10,
  "turn_id": "turn-5",
  "revision": 1,
  "committed_text": "第一段文本。第二段文本。第三段文本。",
  "draft_text": "",
  "display_text": "第一段文本。第二段文本。第三段文本。",
  "is_final_turn": false,
  "is_final_session": true,
  "final": "第一段文本。第二段文本。第三段文本。"
}
```

**特点**：

- `is_final_session` = true
- `committed_text` 包含整个会话的所有文本
- `turn_id` 可能为 null（如果没有轮次）

## 4. Provider 实现规范

### 4.1 使用 TranscriptEmitter

所有 Provider **必须**使用 `TranscriptEmitter` 来推送消息，不要直接调用 `ws.send_json`。

```python
from core.protocol import TranscriptEmitter

emitter = TranscriptEmitter(
    provider=self.name,
    log_label="ALIYUN_TRANSCRIPT",  # 日志标签
    send_json=lambda payload: safe_send_json(ws, payload)
)
```

### 4.2 推送 update 事件

```python
await emitter.emit(
    transcript,
    "update",
    draft=text,                    # 草稿文本
    turn_id=turn_id,
    revision=revision,
)
```

### 4.3 推送 turn_final 事件

```python
await emitter.emit(
    transcript,
    "turn_final",
    turn_id=turn_id,
    revision=revision,
    draft="",                      # 必须为空
    is_final_turn=True,
    latency_ms=123,                # 可选扩展字段
)
```

### 4.4 推送 session_final 事件

```python
await emitter.emit(
    transcript,
    "session_final",
    turn_id=transcript.current_turn_id,
    revision=transcript.revision,
    is_final_session=True,
)
```

## 5. 前端消费规范

### 5.1 统一消费逻辑

前端统一使用 `onTranscriptUpdate` 回调处理所有转写事件，不再区分 partial/final 回调：

```typescript
const audioRecorder = useAudioRecorder({
  onTranscriptUpdate: (payload) => {
    // payload 包含：
    // - event: 'update' | 'turn_final' | 'session_final'
    // - committedText: 已确认文本
    // - draftText: 草稿文本
    // - displayText: 显示文本（committedText + draftText）
    // - isTurnFinal: 是否单轮完成
    // - isSessionFinal: 是否会话结束

    if (payload.isTurnFinal || payload.isSessionFinal) {
      // 单轮/会话完成，提交文本
      submitText(payload.displayText);
    } else {
      // 实时更新识别中的文本
      updateLiveText(payload.displayText);
    }
  }
});
```

## 6. 日志格式规范

所有 Provider 推送消息时，TranscriptEmitter 会自动记录日志：

```
[TRANSCRIPT] event=turn_final seq=6 turn_id=turn-3 revision=3 committed_len=20 draft_len=0 display_tail=...这是识别中的文本
```

**日志字段**：

- `event`: 事件类型
- `seq`: 序列号
- `turn_id`: 轮次 ID
- `revision`: 版本号
- `committed_len`: 已确认文本长度
- `draft_len`: 草稿文本长度
- `display_tail`: 显示文本尾部（最多 48 字符）

## 7. 未来扩展

### 7.1 可能的新增字段

- `confidence`: 识别置信度（0-1）
- `word_timestamps`: 词级时间戳
- `speaker_id`: 说话人 ID（多说话人场景）
- `translation`: 翻译文本（多语言场景）

### 7.2 新增字段规范

新增字段应该：

1. 添加到 `**payload` 中（protocol.py 支持）
2. 在文档中明确说明
3. 保持向后兼容（可选字段）
