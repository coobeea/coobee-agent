# emit_event 后端到前端事件链路缺失 - BUGS

> 创建时间：2026-04-29
> 最近更新：2026-04-29

## 已知问题

### BUG-001: `emit_event` 事件无任何生产监听者（阻塞级）

- **发现时间**：2026-04-29
- **严重程度**：阻塞
- **现象**：Agent 调用 `emit_event` 后返回 success，工具调用记录可见，但前端无任何反应。
- **原因**：`eventBus.emit('agent:event', ...)` 发射后，没有 Publisher / Bridge 监听该事件。
- **位置**：
  - `src/main/agent/tools/builtin/emit-event.ts`
  - `src/main/publishers/`
  - `src/renderer/src/plugins/gatewaySetup.ts`
- **修复方向**：T3 + T4 + T5 + T6
- **状态**：待修复

### BUG-002: `agent:event` 不在 shared 事件类型体系中

- **发现时间**：2026-04-29
- **严重程度**：中
- **现象**：`agent:event` 使用字符串字面量，payload 没有前后端共享契约。
- **原因**：缺少 `src/shared/events/agent.ts`，也没有扩展 `GatewayEventPayloads` / `FrontendEventPayloads`。
- **位置**：
  - `src/shared/events/`
  - `src/main/agent/tools/builtin/emit-event.ts`
- **修复方向**：T1 + T2
- **状态**：待修复

### BUG-003: 多个顶层 `agent:*` 事件会导致 Gateway 事件体系膨胀

- **发现时间**：2026-04-29
- **严重程度**：中
- **现象**：若使用 `agent:open-preview`、`agent:open-file`、`agent:notify` 作为顶层事件，后续新增 action 时需要持续修改 GatewayEventTypes、Publisher、gatewaySetup 等。
- **原因**：把 action 维度放到了 Gateway 顶层事件名，而不是消息 payload 内部。
- **修复方向**：统一使用 `agent:message`，在 message.action 中表达具体动作。
- **状态**：已在方案中修正，待实施

### BUG-004: payload 结构过多会导致工具描述和扩展成本上升

- **发现时间**：2026-04-29
- **严重程度**：中
- **现象**：如果每个 action 都定义不同 payload，例如 `{ url, title }`、`{ path }`、`{ message, level }`，后续 action 扩展时描述和类型会越来越多。
- **原因**：payload 格式没有统一。
- **修复方向**：统一为 `payload.text` 和 `payload.data` 两个字段。
- **状态**：已在方案中修正，待实施

### BUG-005: 原方案中的 `registerPublisher()` 不会被现有 Gateway 自动识别

- **发现时间**：2026-04-29
- **严重程度**：高
- **现象**：如果新增 Publisher 只导出 `registerPublisher()`，Gateway 扫描到文件后不会执行该函数。
- **原因**：Gateway 当前只识别默认导出的数组/对象，或导出名以 `init` 开头的函数。
- **位置**：
  - `src/main/common/gateway/Gateway.ts`
  - 待新增 `src/main/publishers/AgentMessagePublisher.ts`
- **修复方向**：T4 使用 `export default [AgentEventTypes.MESSAGE]`
- **状态**：已在方案中修正，待实施

### BUG-006: 前端缺少 Agent Message handler

- **发现时间**：2026-04-29
- **严重程度**：高
- **现象**：即使 Gateway 收到 `agent:message`，renderer 也没有对应 handler 根据 action 执行打开预览、打开文件或通知。
- **原因**：`gatewaySetup.ts` 没有桥接 `agent:message`，`eventbus/event_handles/` 也没有 `agentEventsHandle.ts`。
- **位置**：
  - `src/renderer/src/plugins/gatewaySetup.ts`
  - `src/renderer/src/eventbus/event_handles/`
  - `src/renderer/src/plugins/eventbusSetup.ts`
- **修复方向**：T5 + T6 + T8
- **状态**：待修复
