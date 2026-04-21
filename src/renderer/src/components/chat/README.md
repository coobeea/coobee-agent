# 消息展示系统架构

完整的组件化消息展示系统，支持流式渲染、多种内容块类型、状态管理。

## 📁 文件结构

```
src/renderer/src/
├── types/
│   └── chat.ts                      # 聊天类型定义
├── stores/
│   └── chat.ts                      # Chat Store（全局消息管理）
├── plugins/
│   └── gatewaySetup.ts              # Gateway 连接 + 全局流式监听
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
    └── agent/
        └── ChatPanel.vue            # 集成示例
```

## 🔄 数据流

```
后端 StreamMessage
      ↓
gatewaySetup 全局监听（应用启动时自动启动）
      ↓
chatStore.handleStreamMessage (自动聚合转换)
      ↓
StreamChatMessage[] 按 threadId 存储
      ↓
组件 computed 自动响应式读取
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
import { computed } from 'vue';
import { useChatStore } from '@/stores/chat';
import { useThreadsStore } from '@/stores/threads';
import { useGateway } from '@/composables/useGateway';
import ChatMessages from '@/components/chat/ChatMessages.vue';

const props = defineProps<{ threadId: string }>();
const chatStore = useChatStore();
const threadsStore = useThreadsStore();
const { request } = useGateway();

// 从 store 读取消息（自动响应式）
const messages = computed(() => chatStore.getThreadMessages(props.threadId));
const isStreaming = computed(() => {
  const thread = threadsStore.threads.find((t) => t.id === props.threadId);
  return thread?.runStatus === 'running' || thread?.runStatus === 'tool-pending';
});

// 发送消息
async function send(content: string): Promise<void> {
  chatStore.addUserMessage(props.threadId, content);
  await request('chat.sendMessage', { threadId: props.threadId, message: content });
}
</script>

<template>
  <ChatMessages :messages="messages" :is-streaming="isStreaming" />
</template>
```

### 2. 完整示例

参考 `ChatPanel.vue` 的实现，包含：
- ✅ 从全局 store 读取消息（自动响应式）
- ✅ 发送消息到 Gateway RPC
- ✅ 加载历史消息
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

在 `chatStore.handleStreamMessage` 中处理 `hitl` 类型消息，创建 `BlockApproval.vue` 组件。

## 🛡️ 状态管理

### useChatStore
- **全局管理所有 thread 的消息**
- 应用启动时自动监听流式消息（通过 gatewaySetup）
- 自动聚合 StreamMessage → StreamChatMessage
- 按 threadId 存储，支持多窗口共享状态
- 自动限制每个 thread 最多 50 条消息

### useThreadsStore
- **管理 thread 列表和状态**
- `thread.runStatus` 是执行状态的唯一真相源
- 前端通过读取 `thread.runStatus` 判断是否正在执行（'running'、'tool-pending'）
- 后端直接从文件读取，无内存缓存

## ⚡ 性能优化

1. **消息限制**：每个 thread 最多保留 50 条消息
2. **虚拟滚动**：可扩展 vue-virtual-scroller
3. **懒加载**：历史消息按需加载（store 无缓存时）
4. **防抖滚动**：避免频繁滚动操作
5. **全局状态共享**：多窗口自动同步，无需重复加载

## 🧪 测试建议

1. **单元测试**：测试 chatStore.handleStreamMessage 的消息聚合逻辑
2. **组件测试**：测试各 Block 组件的渲染
3. **集成测试**：测试全局监听和 store 更新流程
4. **E2E 测试**：测试用户发送消息 → AI 响应的完整流程
5. **多窗口测试**：测试多个窗口打开同一 thread 时的状态同步

## 📚 参考

- `coobee-ai` 项目的消息展示实现
- `src/shared/stream-protocol.ts` - 流式协议定义
- `src/renderer/src/stores/chat.ts` - 全局消息管理
- `src/renderer/src/plugins/gatewaySetup.ts` - 全局流式监听
- `src/main/rpc/ChatMethods.ts` - Chat RPC 方法
- `src/main/agent/AgentEventWriter.ts` - 事件持久化
