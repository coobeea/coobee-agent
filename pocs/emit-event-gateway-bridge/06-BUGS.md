# emit_event 后端→前端事件链路缺失 - BUGS

> 创建时间：2026-04-29

## 已知问题

### BUG-001: emit_event 事件无任何监听者（阻塞级）

- **发现时间**：2026-04-29
- **严重程度**：阻塞（功能完全不可用）
- **现象**：Agent 调用 `emit_event` 后返回 success，`context.jsonl` 中可见工具调用记录，但前端无任何反应
- **原因**：`eventBus.emit('agent:event', ...)` 发射后，无任何 Publisher / Bridge 监听该事件，事件丢失在 EventBus 中
- **位置**：
  - 发射端：`src/main/agent/tools/builtin/emit-event.ts:69`
  - 缺失端：`src/main/publishers/` 目录无 AgentEventPublisher
  - 消费端：`src/renderer/` 无 agent 事件 handler
- **状态**：待修复（见 POC 方案设计）

### BUG-002: `agent:event` 不在事件类型体系中

- **发现时间**：2026-04-29
- **严重程度**：中
- **现象**：`agent:event` 使用字符串字面量，不在 `src/shared/events/` 的类型体系中，没有 TypeScript 类型检查保护
- **位置**：`emit-event.ts:69`、`emit-event.test.ts:36,67`
- **状态**：待修复（随 BUG-001 一起解决）
