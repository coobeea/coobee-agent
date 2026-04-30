# 会话线程（Threads）

Thread 是用户可见的"对话会话"。每个 Thread 绑定一个 Agent，对应一段聊天记录与一份会话产物。

## 存储与 ID

Thread 定义存在 `.home/threads/{threadId}.json`，单 JSON 文件，由 ThreadStore 维护。`threadId` 使用 Snowflake ID（BigInt 字符串，天然有序）。

关键恒等式：`sessionId = threadId`。运行时上下文里的"会话 ID"与"线程 ID"是同一个值，不必区分。

## 定义字段

```json
{
  "id": "283557218403819520",
  "title": "帮我审查代码",
  "agentId": "code-reviewer",
  "agentName": "代码审查专家",
  "sessionId": "283557218403819520",
  "agentHomePath": ".home/agents/code-reviewer",
  "agentMode": "agent",
  "status": "active",
  "runStatus": "idle",
  "createdAt": "2026-04-30T12:00:00.000Z",
  "updatedAt": "2026-04-30T12:05:00.000Z",
  "overrideModel": null,
  "runtimeType": "openai",
  "enableThinking": true,
  "asrEnabled": false,
  "ttsEnabled": false,
  "metadata": {}
}
```

状态字段 `status` 取 `active` / `archived` / `deleted`；`runStatus` 反映当前是否在跑。这些字段不要手动改，走 `/gateway/threads/*` 接口。

## 会话目录 session_dir

每个 Thread 创建时会同步建出会话目录：

```
{agent_home}/sessions/{sessionId}/       ← session_dir
├── history.jsonl         历史消息（系统写）
├── events.jsonl          流式事件（系统写）
├── context.jsonl         上下文快照（系统写）
├── todos.json            当前 todo 列表（todo-write 工具写）
└── sessions/             子会话产物
```

`session_dir` 是当次对话的"唯一落脚点"。`<runtime_environment>` 中的 `session_dir` 字段直接指向这里。

你可以读 `session_dir` 下的任何文件，但除了 `todos.json` 外不要改写任何其他文件。`history.jsonl`、`events.jsonl`、`context.jsonl` 由 HistoryWriter / EventWriter / ContextSnapshot 系统模块独占写入。

## 会话索引

创建 Thread 时，ThreadStore 会自动往 `{agent_home}/sessions.jsonl` 追加一行 `{id, createdAt}`。用它可以快速列出某 Agent 的全部历史会话。

## 给你的操作建议

一、想知道当前会话 ID，读 `<runtime_environment>` 中的 `Agent.Session` 字段。

二、想看之前某次对话的历史，读 `{agent_home}/sessions/{sessionId}/history.jsonl`（例如你在 `sessions.jsonl` 索引里找到目标 id）。

三、需要在会话间传递数据，走 `agent_home/memory/`（永久）或 `workspace/memory/`（session 级）。不要把跨会话信息塞到 `session_dir` 里——`session_dir` 的语义就是"本次对话的产物"。

四、Thread 的增删改由前端/Gateway 负责，Agent 自身一般不直接写 `.home/threads/{threadId}.json`。
