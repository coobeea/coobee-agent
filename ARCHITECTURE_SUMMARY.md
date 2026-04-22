# 统一监听器架构 - 方案总结

## 核心思想

**将所有数据持久化从嵌入式调用改为 eventBus 监听器模式，实现完全解耦。**

---

## 架构对比

### 当前架构（混合模式）

```
consumeAndForward() {
  for (const chunk of gen) {
    eventWriter.dispatch(chunk);  ❌ 直接调用（耦合）
    └─→ writeFile(events.jsonl)
    └─→ emitter.forward(eventBus)
        └─→ WebSocket
        └─→ StreamMonitor (监听器) ✅
  }
}
```

**问题：**
- events.jsonl 写入与核心流程耦合
- 扩展性差（添加新功能需修改核心代码）
- 设计不一致（部分监听器，部分直接调用）

---

### 新架构（统一监听器）

```
consumeAndForward() {
  for (const chunk of gen) {
    emitter.forward(eventBus);  ✅ 只负责广播
  }
}

eventBus 广播到所有监听器：
├─→ WebSocket        → 前端实时显示
├─→ EventWriter      → events.jsonl (调试)
├─→ HistoryWriter    → history.jsonl (前端历史)
└─→ StreamMonitor    → 统计
```

**优势：**
- ✅ 完全解耦，核心流程简洁
- ✅ 扩展容易（添加监听器，不改核心）
- ✅ 设计统一（所有消费者都是监听器）

---

## 文件结构

### 新增文件

```
src/main/agent/streaming/consumers/
├── StreamMonitor.ts          （已存在）统计
├── EventWriter.ts             （新增）events.jsonl 写入
├── HistoryWriter.ts           （新增）history.jsonl 聚合
├── index.ts                   （新增）统一导出
└── StreamConsumersManager.ts  （新增）管理所有监听器

IMPLEMENTATION_GUIDE.md        （实施指南）
ARCHITECTURE_SUMMARY.md        （本文档）
```

### 数据文件

```
workspaces/{sessionId}/
├── events.jsonl       （保留）细粒度事件流，用于调试
├── history.jsonl      （新增）聚合后的对话历史，前端直接使用
├── contexts/          （保留）执行快照
└── sessions/          （保留）SDK 内部使用
```

---

## 核心组件

### 1. EventWriter（监听器）

**职责：** 监听 eventBus，写入 events.jsonl

```typescript
class EventWriter {
  start() {
    eventBus.on(MESSAGE, this.handleMessage);
  }
  
  handleMessage(event) {
    // 写入 events.jsonl
  }
}
```

### 2. HistoryWriter（监听器）

**职责：** 监听 eventBus，实时聚合并写入 history.jsonl

```typescript
class HistoryWriter {
  start() {
    eventBus.on(MESSAGE, this.handleMessage);
  }
  
  handleMessage(event) {
    // 根据事件类型聚合
    // turn:start → 开始新一轮
    // text:delta → 累积文本
    // tool:start/done → 记录工具调用
    // turn:done → 写入 history.jsonl
  }
}
```

**聚合格式（AggregatedMessage）：**

```typescript
{
  id: string;
  role: 'user' | 'assistant';
  timestamp: string;
  content: string;
  thinking?: string;  // AI 思考过程
  tools?: [{          // 工具调用
    name: string;
    arguments: object;
    result: string;
    status: 'done';
  }];
  metadata?: {        // 统计信息
    tokens: { input, output, total };
  };
}
```

### 3. StreamConsumersManager（管理器）

**职责：** 统一管理所有监听器的生命周期

```typescript
class StreamConsumersManager {
  init(workspacesDir) {
    this.streamMonitor.start();
    this.eventWriter.start();
    this.historyWriter.start();
  }
  
  writeUserMessage(sessionId, content) {
    // 用户消息不在 stream 中，需要手动写入
  }
}
```

---

## 实施步骤

### 已完成 ✅

1. ✅ 创建 `EventWriter.ts`
2. ✅ 创建 `HistoryWriter.ts`
3. ✅ 创建 `consumers/index.ts`
4. ✅ 编写详细的实施指南

### 待完成 ⏳

5. ⏳ 修改 `AgentExecutor.ts`
   - 移除 eventWriter 直接调用
   - 改为只调用 emitter.forward()
   
6. ⏳ 创建 `StreamConsumersManager.ts`
   - 管理所有监听器
   
7. ⏳ 在系统启动时初始化监听器
   - 调用 `streamConsumersManager.init()`
   
8. ⏳ 添加用户消息写入
   - 在 execute() 开始时调用
   
9. ⏳ 修改 `ThreadRoutes.ts`
   - 添加读取 history.jsonl 的接口
   
10. ⏳ 简化前端 `ChatPanel.vue`
    - 调用新接口，直接使用聚合数据

---

## 数据流图

### 完整流程

```
┌─────────────────────────────────────────────┐
│  Runtime 执行                                │
│  产生 StreamChunk                            │
└────────────────┬────────────────────────────┘
                 ↓
┌─────────────────────────────────────────────┐
│  AgentExecutor.consumeAndForward()          │
│  emitter.forward(chunk) → eventBus          │
└────────────────┬────────────────────────────┘
                 ↓
        ┌────────┴─────────┐
        │   EventBus       │
        │   广播消息        │
        └────────┬─────────┘
                 ↓
    ┌────────────┼────────────┐
    ↓            ↓            ↓
WebSocket   EventWriter  HistoryWriter
    ↓            ↓            ↓
前端实时   events.jsonl  history.jsonl
```

### 前端加载历史

```
前端打开 Thread
    ↓
GET /threads/:id/history
    ↓
读取 history.jsonl
    ↓
返回聚合后的消息
    ↓
直接渲染（无需复杂解析）
```

---

## 关键优势

### 1. 架构清晰 🏗️

- **单一职责：** consumeAndForward 只负责广播
- **解耦：** 持久化逻辑独立于核心流程
- **一致性：** 所有消费者都是监听器

### 2. 易于扩展 🔧

添加新功能只需：
```typescript
class NewConsumer {
  start() {
    eventBus.on(MESSAGE, this.handle);
  }
}

// 在 StreamConsumersManager 中注册
this.newConsumer.start();
```

### 3. 前端友好 💻

- history.jsonl 已经聚合好
- 无需复杂的 parentId 链式解析
- 格式统一，运行时无关

### 4. 调试能力保留 🔍

- events.jsonl 仍然完整记录
- sessions/*.jsonl 保持不变
- contexts/*.json 继续生成

---

## 性能考虑

### 写入性能

- ✅ 监听器异步处理，不阻塞主流程
- ✅ 文件 I/O 在事件循环中完成
- ✅ 失败不影响 Runtime 执行

### 读取性能

- ✅ history.jsonl 已聚合，直接读取
- ✅ 无需实时聚合（比之前方案快）
- ✅ 文件大小可控（按 turn 聚合）

---

## 向后兼容

### 保留的文件

- ✅ `sessions/*.jsonl` - Runtime 内部需要
- ✅ `events.jsonl` - 调试需要
- ✅ `contexts/*.json` - 快照需要

### 新增的文件

- 🆕 `history.jsonl` - 前端展示专用
- 不影响现有功能
- 可以逐步迁移前端

---

## 测试要点

1. **功能测试**
   - [ ] 对话执行正常
   - [ ] history.jsonl 生成正确
   - [ ] 前端历史加载正常
   - [ ] 工具调用完整记录

2. **边界测试**
   - [ ] 无对话时 history.jsonl 为空
   - [ ] 多轮对话正确聚合
   - [ ] 系统重启后历史保留

3. **性能测试**
   - [ ] 监听器不阻塞主流程
   - [ ] 大量消息时写入稳定
   - [ ] 内存使用正常

---

## 后续优化方向

1. **增量更新**
   - 只聚合新增的 turn
   - 避免重复处理

2. **缓存机制**
   - 内存缓存最近的历史
   - 减少文件读取

3. **压缩归档**
   - 长对话自动分片
   - 历史归档管理

---

## 总结

这个方案通过 **统一监听器架构**，实现了：

✅ **核心流程简化** - 只负责广播，不关心持久化
✅ **完全解耦** - 所有写入通过监听器
✅ **易于扩展** - 添加功能无需改核心
✅ **前端友好** - 聚合历史，直接使用
✅ **运行时无关** - 不依赖 SDK 实现

这是一个**干净、可扩展、易维护**的架构设计！🎯
