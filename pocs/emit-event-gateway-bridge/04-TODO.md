# emit_event 后端到前端事件链路缺失 - TODO

> 创建时间：2026-04-29
> 最近更新：2026-04-29

## 待办任务

### T1. 定义 `src/shared/events/agent.ts` 的 AgentMessage 契约

- **目标**：建立固定 `agent:message` 通道和统一 payload 结构。
- **背景/原因**：当前 `agent:event` 是裸字符串，且上一版多 `agent:*` 顶层事件会导致 Gateway 类型持续膨胀。
- **涉及范围**：
  - `src/shared/events/agent.ts`
- **具体动作**：
  - 新增 `AgentEventTypes.MESSAGE = 'agent:message'`
  - 新增 `BuiltinAgentMessageActions`
    - `notify`
    - `open-preview`
    - `open-file`
  - 新增 `AgentMessagePayload`
    - `text?: string`
    - `data?: Record<string, unknown>`
  - 新增 `AgentMessageMeta`
    - `sessionId?: string`
    - `agentName?: string`
  - 新增 `AgentMessage`
    - `type: 'agent:message'`
    - `action: string`
    - `payload: AgentMessagePayload`
    - `meta: AgentMessageMeta`
    - `timestamp: number`
  - 新增 `isBuiltinAgentMessageAction(action)`
  - 新增 `normalizeAgentMessage(action, payload, meta)`
  - 在 normalize 中校验：
    - `notify`：`payload.text` 必须是非空字符串，`payload.data.level` 可选
    - `open-preview`：`payload.data.url` 必须是非空字符串，`payload.text` 可选
    - `open-file`：`payload.data.path` 必须是非空字符串，`payload.text` 可选
    - 未知 action 返回错误
- **非目标/边界**：
  - 本项不支持任意 action 执行。
  - 本项不把 payload 扩成每个 action 一套类型。
- **验收标准**：
  - [x] shared 层只定义一个 Gateway Agent 通道：`agent:message`
  - [x] payload 只有 `text` 和 `data` 两个业务字段
  - [x] normalize 函数能生成 `AgentMessage`
  - [x] normalize 函数能拒绝未知 action 和无效 payload
- **状态**：[x]

### T2. 扩展 shared Gateway 与 frontend 事件类型

- **目标**：让 GatewayClient 和前端 EventBus 识别唯一的 `agent:message`。
- **背景/原因**：当前 `GatewayEventPayloads` 没有 Agent Message；但不应为每个 action 添加一个 Gateway 事件。
- **涉及范围**：
  - `src/shared/events/gateway.ts`
  - `src/shared/events/frontend.ts`
  - `src/shared/events/index.ts`
- **具体动作**：
  - 在 `GatewayEventTypes` 中新增：
    - `AGENT_MESSAGE: AgentEventTypes.MESSAGE`
  - 在 `GatewayEventPayloads` 中新增：
    - `[GatewayEventTypes.AGENT_MESSAGE]: AgentMessage`
  - 确认 `FrontendEventPayloads` 自动包含 `agent:message`
  - 在 `index.ts` 导出：
    - `AgentEventTypes`
    - `BuiltinAgentMessageActions`
    - `AgentMessage`
    - `AgentMessagePayload`
    - `AgentMessageMeta`
    - helper 函数
- **验收标准**：
  - [x] `gateway.on(GatewayEventTypes.AGENT_MESSAGE, ...)` 有正确 payload 类型
  - [x] `eventBus.on(AgentEventTypes.MESSAGE, ...)` 有正确 payload 类型
  - [x] shared/events 的统一出口能导出 Agent Message 契约
- **状态**：[x]

### T3. 改造 `emit_event` 工具为 AgentMessage 发射端

- **目标**：保留工具简单用法，但内部发射固定 `agent:message`。
- **背景/原因**：当前工具发射 `agent:event` 和 enriched payload，后续无人监听，也没有运行时校验。
- **涉及范围**：
  - `src/main/agent/tools/builtin/emit-event.ts`
- **具体动作**：
  - 引入 `normalizeAgentMessage`
  - 工具参数保持：
    - `event: string`
    - `payload?: { text?: string; data?: Record<string, unknown> }`
  - 在工具描述中说明：
    - `event` 是 action 名称
    - `payload.text` 是用户可见文本
    - `payload.data` 是结构化参数
  - 更新工具描述示例：
    - `notify`: `{ event: 'notify', payload: { text: '任务完成', data: { level: 'success' } } }`
    - `open-preview`: `{ event: 'open-preview', payload: { text: '预览应用', data: { url: 'http://localhost:3000' } } }`
    - `open-file`: `{ event: 'open-file', payload: { text: '查看文件', data: { path: '/abs/file.md' } } }`
  - 执行时调用 normalize，失败时返回 `success: false`
  - 成功时执行 `eventBus.emit(AgentEventTypes.MESSAGE, message)`
  - 删除 `_event/_sessionId/_agentName/_timestamp` 混入 payload 的逻辑
  - 返回结果中记录 action 和 payload
- **非目标/边界**：
  - 不改变工具名称 `emit_event`
  - 暂不把参数名 `event` 改为 `action`
- **验收标准**：
  - [x] 所有支持 action 都发射同一个事件：`agent:message`
  - [x] message.action 正确
  - [x] message.payload 只包含 `text/data`
  - [x] 未知 action 返回失败，不再静默 success
- **状态**：[x]

### T4. 新增数组形式的 `AgentMessagePublisher`

- **目标**：把 Agent Message 从后端 EventBus 自动桥接到 Gateway WebSocket。
- **背景/原因**：Gateway 已支持扫描 `src/main/publishers/**/*Publisher.ts`，数组形式最符合当前需求。
- **涉及范围**：
  - `src/main/publishers/AgentMessagePublisher.ts`
- **具体动作**：
  - 新增文件
  - `import { AgentEventTypes } from '@shared/events/agent'`
  - `export default [AgentEventTypes.MESSAGE]`
- **非目标/边界**：
  - 不写 `registerPublisher()`，因为现有扫描逻辑不会识别这个名字
  - 不为每个 action 新增 Publisher 事件
- **验收标准**：
  - [x] Gateway 自动扫描能发现 `AgentMessagePublisher.ts`
  - [x] `agent:message` 能被 Gateway 原样广播
  - [x] 新增 action 时不需要修改 Publisher
- **状态**：[x]

### T5. 修改 `gatewaySetup.ts` 桥接 `agent:message`

- **目标**：让 renderer 统一从前端 EventBus 消费 Agent Message。
- **背景/原因**：当前 `gatewaySetup.ts` 只桥接了 stream 和 thread 事件。
- **涉及范围**：
  - `src/renderer/src/plugins/gatewaySetup.ts`
- **具体动作**：
  - 增加通用 `bridgeGatewayEvent(eventType)` 小函数
  - 用该函数桥接已有 `stream:message`、`thread:message`
  - 增加桥接：
    - `GatewayEventTypes.AGENT_MESSAGE`
- **非目标/边界**：
  - 本项不执行 UI 行为，只做事件转发
- **验收标准**：
  - [x] Gateway 收到 `agent:message` 后，前端 EventBus 能收到同名事件
  - [x] 现有 stream/thread 桥接行为不变
  - [x] 新增 action 时不需要修改 gatewaySetup
- **状态**：[x]

### T6. 新增 `agentEventsHandle.ts` 按 action 执行前端 UI 行为

- **目标**：在前端集中消费 `agent:message`，并根据 action 调用已有 UI 能力。
- **背景/原因**：项目已有 `eventbus/event_handles/*EventsHandle.ts` 分层，Agent Message 应放在同一层。
- **涉及范围**：
  - `src/renderer/src/eventbus/event_handles/agentEventsHandle.ts`
  - `src/renderer/src/plugins/eventbusSetup.ts`
- **具体动作**：
  - 新增 `agentEventsHandle.ts`
  - 监听 `AgentEventTypes.MESSAGE`
  - `action === 'notify'`
    - 使用 `payload.text` 作为通知文案
    - 使用 `payload.data.level ?? 'info'` 决定 toast 类型
  - `action === 'open-preview'`
    - 使用 `payload.data.url`
    - 使用 `payload.text` 作为标题
    - 调用 `useOpenFiles().openUrl(url, payload.text)`
  - `action === 'open-file'`
    - 使用 `payload.data.path`
    - 调用 `useOpenFiles().openFile(path)`
  - 未知 action 记录 warning
  - 在 `eventbusSetup.ts` 中注册 `setupAgentEvents()`
- **非目标/边界**：
  - 不新增工作台组件
  - 不新增预览 UI，复用 `useOpenFiles.openUrl`
- **验收标准**：
  - [x] `agent:message + notify` 能显示通知
  - [x] `agent:message + open-preview` 能打开 URL 预览标签
  - [x] `agent:message + open-file` 能打开文件标签
  - [x] handler 注册入口在应用启动时执行
- **状态**：[x]

### T7. 更新后端单元测试

- **目标**：覆盖工具规范化和 Publisher 转发声明。
- **背景/原因**：当前测试只验证 `agent:event` 被 emit，无法覆盖新消息结构。
- **涉及范围**：
  - `src/main/agent/tools/__tests__/emit-event.test.ts`
  - 可选新增 `src/main/publishers/__tests__/AgentMessagePublisher.test.ts`
- **具体动作**：
  - 更新 emit_event 测试：
    - 三种 action 都 emit `agent:message`
    - message 包含 `type/action/payload/meta/timestamp`
    - `payload` 只有 `text/data`
    - `notify` 无 text 返回失败
    - `open-preview` 无 data.url 返回失败
    - `open-file` 无 data.path 返回失败
    - 未知 action 返回失败
  - 增加 Publisher 测试：
    - 默认导出等于 `[AgentEventTypes.MESSAGE]`
- **验收标准**：
  - [x] 后端相关测试通过
  - [x] 不再有测试依赖 `agent:event`
  - [x] 不再有测试依赖多个顶层 `agent:*` 事件
- **状态**：[x]

### T8. 新增或补充前端 handler 测试

- **目标**：验证前端收到 Agent Message 后按 action 调用正确 UI 能力。
- **背景/原因**：仅验证后端发射不足以证明用户界面会响应。
- **涉及范围**：
  - `src/renderer/src/eventbus/event_handles/__tests__/agentEventsHandle.test.ts` 或同类测试目录
- **具体动作**：
  - mock `useOpenFiles`
  - mock `vue-sonner`
  - 触发 `eventBus.emit(AgentEventTypes.MESSAGE, notifyMessage)`，断言对应 toast
  - 触发 `eventBus.emit(AgentEventTypes.MESSAGE, openPreviewMessage)`，断言 `openUrl`
  - 触发 `eventBus.emit(AgentEventTypes.MESSAGE, openFileMessage)`，断言 `openFile`
- **验收标准**：
  - [x] 前端 handler 测试通过
  - [x] 三种 action 的 UI 动作都有覆盖
- **状态**：[x]

### T9. 手动端到端验证

- **目标**：确认真实 Agent 工具调用能驱动前端 UI。
- **背景/原因**：本问题发生在跨 EventBus/Gateway/renderer 的集成边界，必须做一次真实链路验证。
- **涉及范围**：
  - 运行中的 Electron 应用
  - 任意可调用 `emit_event` 的 Agent 会话
- **具体动作**：
  - 让 Agent 调用 `emit_event({ event: 'notify', payload: { text: 'hello', data: { level: 'success' } } })`
  - 让 Agent 调用 `emit_event({ event: 'open-preview', payload: { text: '预览', data: { url: 'http://localhost:xxxx' } } })`
  - 让 Agent 调用 `emit_event({ event: 'open-file', payload: { text: '查看文件', data: { path: '/absolute/path' } } })`
  - 检查前端 UI 响应
  - 检查工具块/日志中没有错误
- **验收标准**：
  - [ ] notify toast 可见
  - [ ] URL 预览标签打开
  - [ ] 文件标签打开
  - [ ] 未知 action 能被明确拒绝
- **状态**：[ ]
