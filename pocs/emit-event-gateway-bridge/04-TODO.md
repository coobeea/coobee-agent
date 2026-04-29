# emit_event 后端→前端事件链路缺失 - TODO

> 创建时间：2026-04-29

## 待办任务

### 阶段一：类型契约层

- [ ] **T1**: 新增 `src/shared/events/agent.ts`
  - 定义 `AgentEventTypes` 枚举常量（open-preview / open-file / notify）
  - 定义 `AgentEventPayloads` 接口（按事件类型映射 payload）
  - 定义 `AgentEventMessage` 接口（含 meta 运行时元数据）
- [ ] **T2**: 修改 `src/shared/events/index.ts`
  - 导出 T1 中的新类型

### 阶段二：工具改造

- [ ] **T3**: 修改 `src/main/agent/tools/builtin/emit-event.ts`
  - 引入 `AgentEventTypes`、`AgentEventMessage`
  - 将 `eventBus.emit('agent:event', enrichedPayload)` 改为按类型 emit
  - 构建 `AgentEventMessage` 结构（含 meta）

### 阶段三：后端 Publisher 桥接

- [ ] **T4**: 新增 `src/main/publishers/AgentEventPublisher.ts`
  - 监听 `AgentEventTypes` 的三种事件
  - 通过 `gateway.broadcastEvent()` 推送到前端
  - 返回 cleanup 函数
- [ ] **T5**: 确认 Publisher 注册机制
  - 如果是自动扫描：验证新文件是否被正确加载
  - 如果是显式注册：找到注册入口添加 import

### 阶段四：前端消费

- [ ] **T6**: 在前端 `gatewaySetup` 或相关插件中添加 Agent 事件监听
  - `agent:open-preview` → 打开 iframe 预览面板
  - `agent:open-file` → 在工作台打开文件
  - `agent:notify` → 调用 toast 通知组件

### 阶段五：测试

- [ ] **T7**: 更新 `emit-event.test.ts`
  - 验证事件按新类型 emit
  - 验证 AgentEventMessage 结构正确
- [ ] **T8**: 端到端验证
  - Agent 调用 emit_event 后前端确认收到事件
  - context.jsonl 中记录完整事件信息
