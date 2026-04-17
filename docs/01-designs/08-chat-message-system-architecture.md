# 聊天消息展示系统架构设计

> 日期：2026-04-17  
> 版本：v1.0  
> 状态：✅ 已实施

## 概述

完整的组件化聊天消息展示系统，支持流式渲染、多种内容块类型（文本、思考、工具调用）、状态管理和 WebSocket 实时订阅。

## 系统架构

### 整体数据流

```
┌─────────────────────────────────────────────────────────────┐
│                         后端                                 │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  AgentEventWriter  ──→  events.jsonl  ──→  StreamEmitter    │
│       (写入)              (持久化)          (推送)           │
│                                                               │
│                            ↓                                  │
│                                                               │
│                     Gateway WebSocket                        │
│                    (stream:message 频道)                     │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────┐
│                        前端                                  │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  useStreamWs (WebSocket 订阅管理)                            │
│       ↓                                                      │
│  useStreamHandler (消息转换 & 状态管理)                     │
│       ↓                                                      │
│  StreamChatMessage + ContentBlock[]                         │
│       ↓                                                      │
│  Vue 组件渲染                                                │
│    ├─ ChatMessages (容器)                                   │
│    ├─ MessageItemUser (用户消息)                            │
│    └─ MessageItemAssistant (AI 消息)                        │
│         ├─ BlockText (文本)                                  │
│         ├─ BlockThinking (思考)                              │
│         └─ BlockTool (工具调用)                              │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## 核心模块

### 1. 类型定义 (`types/chat.ts`)

定义前端消息结构，与后端 StreamMessage 解耦：

```typescript
// 消息状态
type MessageStatus = 'pending' | 'streaming' | 'done' | 'error';

// 内容块类型
type ContentBlockType = 'text' | 'thinking' | 'tool';

// 内容块
interface ContentBlock {
  type: ContentBlockType;
  text?: string;           // 文本/思考内容
  tool?: ToolCall;         // 工具调用信息
}

// 聊天消息
interface StreamChatMessage {
  id: string;
  role: 'user' | 'assistant';
  blocks: ContentBlock[];  // 多块内容
  status: MessageStatus;
  timestamp: number;
}
```

### 2. 状态管理 (`stores/chat.ts`)

全局管理各 thread 的流状态：

```typescript
interface StreamState {
  isStreaming: boolean;      // 是否正在流式响应
  currentSequence: number;   // 当前序号
}

const streamStates = Map<string, StreamState>  // threadId -> state
```

**职责**：
- ✅ 管理多个 thread 的流状态
- ✅ 支持查询/设置/重置状态
- ⚠️ 不存储消息列表（由组件本地管理）

### 3. WebSocket 订阅管理 (`useStreamWs.ts`)

全局单例，管理所有 thread 的订阅：

```typescript
class StreamSubscriptionManager {
  subscriptions: Map<sessionId, Set<callback>>
  
  subscribe(sessionId, callback)    // 订阅
  unsubscribe(sessionId, callback)  // 取消订阅
}
```

**特性**：
- ✅ 支持多个组件订阅同一个 thread
- ✅ 自动路由消息到订阅者
- ✅ 自动调用 Gateway RPC（stream.subscribe / stream.unsubscribe）
- ✅ 全局初始化一次 Gateway 监听

### 4. 消息处理器 (`useStreamHandler.ts`)

组件级状态，将后端 StreamMessage 转换为 UI 结构：

```typescript
function useStreamHandler() {
  const messages = ref<StreamChatMessage[]>([])
  
  function handleStreamMessage(msg: StreamMessage) {
    switch (msg.type) {
      case 'run:start':       // 创建新 assistant 消息
      case 'reasoning:delta': // 累积思考内容
      case 'tool:start':      // 添加工具调用块
      case 'tool:done':       // 更新工具结果
      case 'text:delta':      // 累积文本内容
      case 'run:done':        // 标记完成
      case 'run:error':       // 标记错误
    }
  }
  
  return { messages, handleStreamMessage, addUserMessage, ... }
}
```

**核心逻辑**：
1. **run:start** → 创建新的 assistant 消息
2. **reasoning:delta** → 找到/创建 thinking 块，累积内容
3. **tool:start** → 添加 tool 块，状态为 calling
4. **tool:done** → 找到最后一个 calling 状态的 tool 块，更新结果和状态
5. **text:delta** → 找到/创建最后一个 text 块，累积内容
6. **run:done** → 标记消息状态为 done
7. **run:error** → 标记消息状态为 error，添加错误块

### 5. 组件层级

```
ChatMessages (消息列表容器)
├── MessageItemUser (用户消息)
│   └── text block
└── MessageItemAssistant (AI 消息)
    ├── BlockText (文本内容)
    ├── BlockThinking (思考过程，可折叠)
    └── BlockTool (工具调用，带状态图标)
```

#### ChatMessages.vue
- 消息列表容器
- 自动滚动到底部
- 空状态提示
- 流式加载指示器

#### MessageItemUser.vue
- 用户头像
- 简单文本渲染

#### MessageItemAssistant.vue
- AI 头像
- 遍历 blocks，根据 type 渲染不同组件
- 错误状态提示

#### BlockText.vue
- 纯文本渲染（pre-wrap）
- 可扩展 Markdown 支持

#### BlockThinking.vue
- 折叠/展开状态
- 淡化样式
- 图标指示

#### BlockTool.vue
- 工具名称
- 状态图标（calling / done / error / approval-pending）
- 参数展示（代码块样式）
- 结果展示
- 错误展示

## 状态管理策略

### 全局状态（Pinia Store）
- **用途**：管理多个 thread 的流状态（是否正在流式响应）
- **存储内容**：`Map<threadId, { isStreaming, currentSequence }>`
- **更新时机**：收到 `run:start` / `run:done` / `run:error` 时

### 组件状态（useStreamHandler）
- **用途**：管理单个聊天面板的消息列表
- **存储内容**：`StreamChatMessage[]`
- **更新时机**：收到任何 StreamMessage 时
- **生命周期**：组件挂载时创建，卸载时销毁

### 订阅状态（useStreamWs）
- **用途**：管理 WebSocket 订阅关系
- **存储内容**：`Map<sessionId, Set<callback>>`
- **更新时机**：组件订阅/取消订阅时
- **生命周期**：全局单例，持续存活

## 集成示例

### AgentChatPanel.vue

```vue
<script setup lang="ts">
import { useStreamHandler } from '@/composables/useStreamHandler';
import { streamSubscribe, streamUnsubscribe } from '@/composables/useStreamWs';
import { useChatStore } from '@/stores/chat';
import ChatMessages from '@/components/chat/ChatMessages.vue';

const chatStore = useChatStore();
const { messages, isStreaming, handleStreamMessage, addUserMessage } = useStreamHandler();

// 1. 订阅流式消息
function ensureSubscription() {
  streamSubscribe(threadId.value, handleStreamMessageWithSync);
}

// 2. 处理消息 + 同步状态
function handleStreamMessageWithSync(msg: StreamMessage) {
  handleStreamMessage(msg);
  
  if (msg.type === 'run:start') {
    chatStore.setState(threadId.value, true, msg.sequence);
  } else if (msg.type === 'run:done' || msg.type === 'run:error') {
    chatStore.setState(threadId.value, false, msg.sequence);
  }
}

// 3. 发送消息
async function sendMessage() {
  addUserMessage(content);
  await gateway.request('chat.sendMessage', { threadId, content });
}

// 4. 生命周期管理
onMounted(() => ensureSubscription());
onUnmounted(() => streamUnsubscribe(threadId.value, handleStreamMessageWithSync));
</script>

<template>
  <ChatMessages :messages="messages" :is-streaming="isStreaming" />
</template>
```

## 扩展点

### 1. 添加新的内容块类型

```typescript
// 1. 扩展类型定义
export type ContentBlockType = 'text' | 'thinking' | 'tool' | 'image';

// 2. 扩展 ContentBlock 接口
export interface ContentBlock {
  type: ContentBlockType;
  text?: string;
  tool?: ToolCall;
  image?: { url: string; alt?: string }; // 新增
}

// 3. 在 useStreamHandler 中处理新消息类型
case 'image:url':
  currentAssistantMsg.blocks.push({
    type: 'image',
    image: { url: msg.content, alt: msg.data?.alt }
  });
  break;

// 4. 创建新的 Block 组件
// BlockImage.vue

// 5. 在 MessageItemAssistant 中渲染
<BlockImage v-else-if="block.type === 'image'" :image="block.image" />
```

### 2. 集成 Markdown 渲染器

```bash
pnpm add marked highlight.js
```

```vue
<!-- BlockText.vue -->
<script setup lang="ts">
import { marked } from 'marked';
import hljs from 'highlight.js';
import { computed } from 'vue';

marked.setOptions({
  highlight: (code, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return code;
  }
});

const props = defineProps<{ text: string }>();
const html = computed(() => marked.parse(props.text));
</script>

<template>
  <div class="block-text markdown-body" v-html="html"></div>
</template>
```

### 3. 历史消息加载

```typescript
// 在 AgentChatPanel.vue 中添加
async function loadHistory() {
  const res = await fetch(`/gateway/threads/${threadId.value}/history`);
  const { events, userMessages } = await res.json();
  
  let userIdx = 0;
  for (const evt of events) {
    const streamMsg: StreamMessage = {
      id: `hist-${evt.seq}`,
      sessionId: threadId.value,
      sequence: evt.seq,
      timestamp: new Date(evt.ts).getTime(),
      type: evt.type,
      content: evt.content,
      data: evt.data,
      source: { type: 'agent', id: agentId, name: '' }
    };
    
    if (evt.type === 'run:start' && userIdx < userMessages.length) {
      addUserMessage(userMessages[userIdx].content);
      userIdx++;
    }
    
    handleStreamMessage(streamMsg);
  }
}

onMounted(async () => {
  await loadHistory();
  ensureSubscription();
});
```

## 性能优化

### 1. 虚拟滚动

对于超长消息列表，可以集成虚拟滚动：

```bash
pnpm add vue-virtual-scroller
```

```vue
<RecycleScroller
  :items="messages"
  :item-size="80"
  key-field="id"
  v-slot="{ item }">
  <MessageItemUser v-if="item.role === 'user'" :message="item" />
  <MessageItemAssistant v-else :message="item" />
</RecycleScroller>
```

### 2. 消息限制

在 `useStreamHandler` 中设置 `maxMessages`：

```typescript
const { messages, ... } = useStreamHandler({
  maxMessages: 500  // 限制最多 500 条消息
});
```

### 3. 防抖滚动

```typescript
import { useDebounceFn } from '@vueuse/core';

const scrollToBottom = useDebounceFn((container: HTMLElement) => {
  container.scrollTop = container.scrollHeight;
}, 100);
```

## 测试建议

### 单元测试

```typescript
import { describe, it, expect } from 'vitest';
import { useStreamHandler } from '@/composables/useStreamHandler';

describe('useStreamHandler', () => {
  it('should create assistant message on run:start', () => {
    const { messages, handleStreamMessage } = useStreamHandler();
    
    handleStreamMessage({
      id: 'test-1',
      type: 'run:start',
      sessionId: 'thread-1',
      sequence: 1,
      content: '',
      timestamp: Date.now(),
      source: { type: 'agent', id: 'agent-1', name: '' }
    });
    
    expect(messages.value.length).toBe(1);
    expect(messages.value[0].role).toBe('assistant');
    expect(messages.value[0].status).toBe('streaming');
  });
  
  it('should accumulate text content', () => {
    // ...
  });
});
```

### 组件测试

```typescript
import { mount } from '@vue/test-utils';
import BlockTool from '@/components/chat/blocks/BlockTool.vue';

describe('BlockTool', () => {
  it('should render tool name', () => {
    const wrapper = mount(BlockTool, {
      props: {
        tool: { name: 'read', status: 'calling' }
      }
    });
    
    expect(wrapper.text()).toContain('read');
  });
});
```

## 技术决策

### 为什么消息列表由组件本地管理？

**原因**：
1. **性能**：大量消息存储在全局 Store 会导致性能问题
2. **生命周期**：消息列表应该随组件销毁而清空
3. **隔离性**：不同聊天面板的消息互不干扰

**替代方案**：
- 使用 Pinia Store + 弱引用
- 使用 IndexedDB 持久化

### 为什么使用 ContentBlock 而不是直接渲染 StreamMessage？

**原因**：
1. **前端友好**：ContentBlock 是 UI 导向的结构
2. **累积逻辑**：文本内容需要累积，后端 StreamMessage 是增量的
3. **扩展性**：前端可以自定义更多块类型

### 为什么 useStreamWs 是全局单例？

**原因**：
1. **订阅复用**：多个组件订阅同一个 thread 时，只发起一次 WebSocket 订阅
2. **事件路由**：统一分发消息到所有订阅者
3. **资源管理**：避免重复连接

## 未来优化

### 1. 历史消息分页加载
- 实现 `/gateway/threads/{threadId}/history?offset=0&limit=50`
- 滚动到顶部时自动加载更多

### 2. 消息持久化
- 使用 IndexedDB 本地缓存
- 离线查看历史消息

### 3. HITL 审批 UI
- 添加审批按钮（批准/拒绝）
- 调用 Gateway RPC 提交决策

### 4. 富文本编辑器
- 支持代码高亮输入
- 支持文件上传

### 5. 消息搜索
- 全文搜索
- 按时间/类型筛选

## 参考资料

- `coobee-ai` 项目的消息展示实现
- [Vue 3 Composition API](https://vuejs.org/guide/extras/composition-api-faq.html)
- [Pinia 状态管理](https://pinia.vuejs.org/)
- [WebSocket 协议设计](../../shared/stream-protocol.ts)
