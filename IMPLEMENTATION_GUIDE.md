# 统一监听器架构 - 实施指南

## 概述

将所有数据持久化从嵌入式调用改为 eventBus 监听器模式，实现完全解耦。

---

## 已完成的工作

### 1. 新增文件

✅ `src/main/agent/streaming/consumers/EventWriter.ts`
   - 监听 eventBus，写入 events.jsonl
   - 替代原有的 AgentEventWriter 直接调用

✅ `src/main/agent/streaming/consumers/HistoryWriter.ts`
   - 监听 eventBus，生成 history.jsonl
   - 聚合对话历史，前端友好格式

✅ `src/main/agent/streaming/consumers/index.ts`
   - 统一导出所有消费者

---

## 待完成的工作

### 2. 修改 AgentExecutor.ts

#### 2.1 移除 AgentEventWriter 相关代码

**删除导入：**
```typescript
// 删除这行
import { AgentEventWriter } from './AgentEventWriter';
```

**修改 consumeAndForward 签名：**
```typescript
// 修改前：
private async *consumeAndForward(
  gen: AsyncGenerator<StreamChunk, ExecutionResult, unknown>,
  eventWriter: AgentEventWriter | null,  // ❌ 删除这个参数
  sessionId: string,
  // ...
)

// 修改后：
private async *consumeAndForward(
  gen: AsyncGenerator<StreamChunk, ExecutionResult, unknown>,
  emitter: IStreamEmitter,  // ✅ 改为直接传入 emitter
  sessionId: string,
  // ...
)
```

**修改 consumeAndForward 内部逻辑：**
```typescript
// 修改前（约在 276-279 行）：
if (eventWriter) {
  eventWriter.dispatch(chunk);  // ❌ 删除
}

// 修改后：
emitter.forward(chunk);  // ✅ 只负责广播到 eventBus
```

**同样修改中止信号处理部分（约在 263-265 行）：**
```typescript
// 修改前：
if (eventWriter) {
  eventWriter.dispatch(interruptedChunk);  // ❌ 删除
}

// 修改后：
emitter.forward(interruptedChunk);  // ✅ 改为直接用 emitter
```

**移除其他 eventWriter 相关逻辑（约在 289-295 行）：**
```typescript
// 修改前：
if (eventWriter) {
  fireHooks(...);
}

// 修改后：
// Hook 触发不需要依赖 eventWriter
fireHooks(...);
```

#### 2.2 修改 execute() 方法中的 eventWriter 创建

**在 execute() 方法中（约在 465-475 行和 520-542 行）：**

```typescript
// 修改前：
let eventWriter: AgentEventWriter | null = null;

if (!isLightweight) {
  eventWriter = new AgentEventWriter(workspaceDir);
  eventWriter.register(sessionId);
}

// ...

if (eventWriter) {
  eventWriter.setEmitter(this.createEmitter(sessionId, runtime));
}

// 修改后：
let emitter: IStreamEmitter | null = null;

if (!isLightweight) {
  emitter = this.createEmitter(sessionId, runtime);
}
```

**修改 consumeAndForward 调用：**
```typescript
// 修改前：
const result = yield* this.consumeAndForward(
  gen,
  eventWriter,  // ❌ 
  sessionId,
  // ...
);

// 修改后：
const result = yield* this.consumeAndForward(
  gen,
  emitter!,  // ✅ 传入 emitter（非 null 断言，因为 !isLightweight 时必定创建）
  sessionId,
  // ...
);
```

#### 2.3 清理不再需要的代码

- ❌ 删除 `eventWriter.register()` 调用
- ❌ 删除 `eventWriter.unregister()` 调用  
- ❌ 删除 `eventWriter.destroy()` 调用

---

### 3. 初始化监听器（新增启动逻辑）

#### 3.1 创建 StreamConsumersManager

创建新文件：`src/main/agent/streaming/StreamConsumersManager.ts`

```typescript
/**
 * 流式消费者管理器
 * 
 * 在系统启动时初始化所有监听器
 */

import { createLogger } from '@main/common/logger';
import { StreamMonitor } from './consumers/StreamMonitor';
import { EventWriter } from './consumers/EventWriter';
import { HistoryWriter } from './consumers/HistoryWriter';

const log = createLogger('stream-consumers');

export class StreamConsumersManager {
  private streamMonitor: StreamMonitor | null = null;
  private eventWriter: EventWriter | null = null;
  private historyWriter: HistoryWriter | null = null;
  private initialized = false;

  /**
   * 初始化所有消费者
   */
  init(workspacesDir: string): void {
    if (this.initialized) {
      log.warn('[StreamConsumersManager] Already initialized');
      return;
    }

    // 1. 启动统计监听器
    this.streamMonitor = new StreamMonitor();
    this.streamMonitor.start();

    // 2. 启动事件写入器
    this.eventWriter = new EventWriter(workspacesDir);
    this.eventWriter.start();

    // 3. 启动历史聚合写入器
    this.historyWriter = new HistoryWriter(workspacesDir);
    this.historyWriter.start();

    this.initialized = true;
    log.info('[StreamConsumersManager] All consumers initialized');
  }

  /**
   * 清理资源
   */
  destroy(): void {
    if (!this.initialized) return;

    this.streamMonitor?.stop();
    this.eventWriter?.stop();
    this.historyWriter?.stop();

    this.initialized = false;
    log.info('[StreamConsumersManager] All consumers stopped');
  }

  /**
   * 写入用户消息（供外部调用）
   */
  writeUserMessage(sessionId: string, content: string, timestamp?: string): void {
    this.historyWriter?.writeUserMessage(sessionId, content, timestamp);
  }

  /**
   * 获取历史写入器（供外部访问）
   */
  getHistoryWriter(): HistoryWriter | null {
    return this.historyWriter;
  }
}

// 全局单例
export const streamConsumersManager = new StreamConsumersManager();
```

#### 3.2 在系统启动时初始化

修改 `src/main/agent/AgentExecutor.ts` 或在 `src/main/index.ts` 中：

```typescript
import { streamConsumersManager } from './streaming/StreamConsumersManager';

// 在适当的地方初始化（例如 AgentExecutor 构造函数或系统启动时）
const workspacesDir = path.join(app.getPath('userData'), 'workspaces');
streamConsumersManager.init(workspacesDir);
```

#### 3.3 写入用户消息

在 `AgentExecutor.execute()` 开始时：

```typescript
// 在开始执行前，写入用户消息
if (!isLightweight) {
  streamConsumersManager.writeUserMessage(
    sessionId,
    request.message,
    new Date().toISOString()
  );
}
```

---

### 4. 添加后端路由（读取 history.jsonl）

修改 `src/main/routes/ThreadRoutes.ts`：

```typescript
// 新增路由：读取聚合历史
router.get('/threads/:threadId/history', async (ctx) => {
  const { threadId } = ctx.params;
  
  const historyFile = path.join(workspacesDir, threadId, 'history.jsonl');
  
  // 如果文件不存在，返回空数组
  if (!(await fs.pathExists(historyFile))) {
    ctx.body = { success: true, data: { messages: [] } };
    return;
  }
  
  try {
    const content = await fs.readFile(historyFile, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    const messages = lines.map(line => JSON.parse(line));
    
    ctx.body = {
      success: true,
      data: { messages }
    };
  } catch (err) {
    log.error('[history] Read failed:', err);
    ctx.status = 500;
    ctx.body = { success: false, error: 'Failed to read history' };
  }
});
```

---

### 5. 前端适配（简化）

修改 `src/renderer/src/components/agent/ChatPanel.vue`：

```typescript
async function loadThreadHistory(): Promise<void> {
  if (messages.value.length > 0) {
    return;
  }

  try {
    // 🔥 调用新的聚合历史接口
    const result = await getThreadHistory(props.threadId);
    
    if (!result.success || !result.data) {
      console.warn('[ChatPanel] 历史加载失败:', result.error);
      return;
    }

    // 🔥 直接使用聚合后的消息，无需复杂解析
    const history = result.data.messages || [];
    
    for (const msg of history) {
      if (msg.role === 'user') {
        chatStore.addUserMessage(props.threadId, msg.content);
      } else if (msg.role === 'assistant') {
        // 转换为 StreamChatMessage 格式
        const chatMsg: StreamChatMessage = {
          id: msg.id,
          role: 'assistant',
          content: msg.content,
          blocks: [],
          status: 'done',
          timestamp: new Date(msg.timestamp).getTime()
        };
        
        // 添加 thinking block
        if (msg.thinking) {
          chatMsg.blocks.push({
            type: 'thinking',
            text: msg.thinking
          });
        }
        
        // 添加 text block
        if (msg.content) {
          chatMsg.blocks.push({
            type: 'text',
            text: msg.content
          });
        }
        
        // 添加 tool blocks
        if (msg.tools && msg.tools.length > 0) {
          for (const tool of msg.tools) {
            chatMsg.blocks.push({
              type: 'tool',
              tool: {
                name: tool.name,
                arguments: JSON.stringify(tool.arguments || {}, null, 2),
                result: tool.result || '',
                status: tool.status
              }
            });
          }
        }
        
        // 添加统计信息
        if (msg.metadata?.tokens) {
          chatMsg.stats = {
            inputTokens: msg.metadata.tokens.inputTokens,
            outputTokens: msg.metadata.tokens.outputTokens,
            totalTokens: msg.metadata.tokens.totalTokens,
            llmCalls: 1,
            toolCalls: msg.tools?.length || 0
          };
        }
        
        chatStore.addHistoryMessage(props.threadId, chatMsg);
      }
    }

    await nextTick();
    scrollToBottom(true);
  } catch (err: unknown) {
    console.error('[ChatPanel] loadThreadHistory error:', err);
  }
}
```

---

## 优势总结

### ✅ 架构改进

1. **完全解耦**
   - consumeAndForward 只负责广播，不关心持久化
   - 所有写入通过监听器实现

2. **易于扩展**
   - 添加新功能：只需添加新的监听器
   - 无需修改核心流程

3. **统一模式**
   - StreamMonitor、EventWriter、HistoryWriter 都是监听器
   - 架构一致，易于理解和维护

4. **前端友好**
   - history.jsonl 已聚合，直接使用
   - 无需复杂的 parentId 链式解析

### ✅ 数据流

```
Runtime → StreamChunk
    ↓
emitter.forward() → eventBus
    ↓
    ├─→ WebSocket → 前端实时显示
    ├─→ EventWriter → events.jsonl (调试)
    ├─→ HistoryWriter → history.jsonl (前端历史)
    └─→ StreamMonitor → 统计
```

---

## 测试清单

- [ ] 启动系统，确认监听器初始化成功
- [ ] 执行一次对话，检查 history.jsonl 是否生成
- [ ] 检查 history.jsonl 内容格式是否正确
- [ ] 前端加载历史消息，确认显示正常
- [ ] 包含工具调用的对话，确认工具信息完整
- [ ] 重启系统，历史加载正常
- [ ] events.jsonl 仍然正常写入（保持调试能力）

---

## 回滚方案

如果出现问题，可以通过以下方式回滚：

1. 恢复 AgentExecutor 中的 eventWriter 调用
2. 停用新的监听器
3. 前端继续使用原有的 sessions/*.jsonl 读取逻辑

---

## 注意事项

1. **用户消息写入时机**
   - 需要在 execute() 开始时调用 `streamConsumersManager.writeUserMessage()`
   - 因为用户消息不在 stream 事件流中

2. **Workspace 路径**
   - 确保 workspacesDir 路径正确
   - 在 streamConsumersManager.init() 时传入

3. **向后兼容**
   - 保留 sessions/*.jsonl（Runtime 内部需要）
   - 保留 events.jsonl（调试需要）
   - history.jsonl 是新增的，不影响现有功能

4. **性能考虑**
   - 监听器是异步写入，不阻塞主流程
   - 文件 I/O 在单独的事件处理中完成
