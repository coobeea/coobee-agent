# 消息展示系统架构

完整的组件化消息展示系统，支持流式渲染、多种内容块类型、状态管理。

## 📁 文件结构

```
src/renderer/src/
├── types/
│   └── chat.ts                      # 聊天类型定义
├── stores/
│   └── chat.ts                      # Chat Store（流状态管理）
├── composables/
│   ├── useStreamHandler.ts          # 流式消息处理器
│   └── useStreamWs.ts               # WebSocket 订阅管理
└── components/
    ├── chat/
    │   ├── README.md                # 本文档
    │   ├── ChatMessages.vue         # 消息列表容器
    │   ├── MessageItemUser.vue      # 用户消息
    │   ├── MessageItemAssistant.vue # AI 消息
    │   └── blocks/
    │       ├── BlockText.vue        # 文本内容块
    │       ├── BlockThinking.vue    # 思考过程块（带折叠）
    │       └── BlockTool.vue        # 工具调用块（带状态）
    └── workspace/
        └── AgentChatPanel.vue       # 集成示例
```

## 🔄 数据流

```
后端 StreamMessage
      ↓
useStreamWs (订阅管理)
      ↓
useStreamHandler (消息转换)
      ↓
StreamChatMessage + ContentBlock[]
      ↓
ChatMessages + MessageItem* + Block* (组件渲染)
```

## 📝 核心类型

### StreamChatMessage

```typescript
interface StreamChatMessage {
  id: string;                    // 消息 ID
  role: 'user' | 'assistant';    // 角色
  blocks: ContentBlock[];        // 内容块列表
  status: MessageStatus;         // 消息状态
  timestamp: number;             // 时间戳
}
```

### ContentBlock

```typescript
interface ContentBlock {
  type: 'text' | 'thinking' | 'tool';  // 块类型
  text?: string;                        // 文本内容
  tool?: ToolCall;                      // 工具调用信息
}
```

### ToolCall

```typescript
interface ToolCall {
  name?: string;                    // 工具名称
  arguments?: string;               // 工具参数
  result?: string;                  // 工具结果
  status: ToolCallStatus;           // 状态
  error?: string;                   // 错误信息
}
```

## 🎯 使用方式

### 1. 基础集成

```vue
<script setup lang="ts">
import { useStreamHandler } from '@/composables/useStreamHandler';
import { streamSubscribe, streamUnsubscribe } from '@/composables/useStreamWs';
import ChatMessages from '@/components/chat/ChatMessages.vue';
import type { StreamMessage } from '@shared/stream-protocol';

const { messages, isStreaming, handleStreamMessage, addUserMessage } = useStreamHandler();

// 订阅流式消息
function subscribe(threadId: string): void {
  streamSubscribe(threadId, handleStreamMessage);
}

// 发送消息
async function send(content: string): Promise<void> {
  addUserMessage(content);
  await gateway.request('chat.sendMessage', { threadId, content });
}
</script>

<template>
  <ChatMessages :messages="messages" :is-streaming="isStreaming" />
</template>
```

### 2. 完整示例

参考 `AgentChatPanel.vue` 的实现，包含：
- ✅ 消息订阅和取消订阅
- ✅ 发送消息到 Gateway RPC
- ✅ 状态同步到 Store
- ✅ 错误处理
- ✅ 清空对话

## 🎨 组件特性

### ChatMessages
- 自动滚动到底部
- 空状态提示
- 流式加载指示器

### MessageItemUser
- 用户头像
- 文本内容渲染

### MessageItemAssistant
- AI 头像
- 多块内容渲染
- 错误状态提示

### BlockText
- 纯文本渲染
- 支持换行（pre-wrap）
- 可扩展 Markdown 渲染

### BlockThinking
- 折叠/展开切换
- 思考过程展示
- 淡化样式

### BlockTool
- 工具名称展示
- 状态图标（执行中、完成、失败、等待审批）
- 参数展示（代码块样式）
- 结果展示
- 错误展示

## 🔌 扩展点

### 1. 添加新的内容块类型

```typescript
// types/chat.ts
export type ContentBlockType = 'text' | 'thinking' | 'tool' | 'image'; // 添加 image

export interface ContentBlock {
  type: ContentBlockType;
  text?: string;
  tool?: ToolCall;
  image?: { url: string; alt?: string }; // 新增
}

// 创建 BlockImage.vue

// MessageItemAssistant.vue 中添加渲染逻辑
<BlockImage v-else-if="block.type === 'image' && block.image" :image="block.image" />
```

### 2. 集成 Markdown 渲染器

```bash
pnpm add marked
```

```vue
<!-- BlockText.vue -->
<script setup lang="ts">
import { marked } from 'marked';
import { computed } from 'vue';

const props = defineProps<{ text: string }>();
const html = computed(() => marked.parse(props.text));
</script>

<template>
  <div class="block-text" v-html="html"></div>
</template>
```

### 3. 添加 HITL 审批 UI

在 `useStreamHandler.ts` 中处理 `hitl` 类型消息，创建 `BlockApproval.vue` 组件。

## 🛡️ 状态管理

### useChatStore
- 管理多个 thread 的流状态（是否正在流式响应）
- 每个 thread 的消息列表由组件本地管理（useStreamHandler）

### useStreamHandler
- 组件级状态，每个聊天面板独立维护
- 将 StreamMessage 转换为 UI 可渲染的 ContentBlock 结构
- 支持消息累积、状态更新

### useStreamWs
- 全局 WebSocket 订阅管理
- 支持多个组件订阅同一个 thread
- 自动路由消息到订阅者

## ⚡ 性能优化

1. **消息限制**：`maxMessages` 参数限制消息数量
2. **虚拟滚动**：可扩展 vue-virtual-scroller
3. **懒加载**：历史消息分页加载
4. **防抖滚动**：避免频繁滚动操作

## 🧪 测试建议

1. **单元测试**：测试 useStreamHandler 的消息转换逻辑
2. **组件测试**：测试各 Block 组件的渲染
3. **集成测试**：测试完整的消息流转和订阅机制
4. **E2E 测试**：测试用户发送消息 → AI 响应的完整流程

## 📚 参考

- `coobee-ai` 项目的消息展示实现
- `src/shared/stream-protocol.ts` - 流式协议定义
- `src/main/rpc/ChatMethods.ts` - Chat RPC 方法
- `src/main/ai/AgentEventWriter.ts` - 事件持久化
