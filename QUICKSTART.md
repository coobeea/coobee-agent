# Coobee Agent 快速上手指南

## 🚀 如何体验聊天系统

### 1. 启动应用

```bash
# 安装依赖（首次运行）
pnpm install

# 启动开发模式
pnpm dev
```

应用启动后会自动打开窗口。

### 2. 进入 Agent 工作区

**方式 1：从 Agent 列表进入**

1. 点击侧边栏的 **"智能体"** 图标（或导航到 `/agents`）
2. 在 Agent 列表中，点击任意 Agent 卡片右上角的 **"进入工作区"** 按钮
3. 自动跳转到 Agent 工作区视图

**方式 2：直接访问 URL**

在开发模式下，可以直接访问：
```
http://localhost:8765/#/agent-workspace/{agentId}
```

例如：
```
http://localhost:8765/#/agent-workspace/app-copilot
```

### 3. 使用聊天功能

进入 Agent 工作区后，你会看到：

```
┌──────────────────────────────────────────────────────────┐
│                     Agent 工作区                         │
├──────────┬─────────────────────────┬─────────────────────┤
│          │                         │  ┌─ Agent 信息 ─┐  │
│  文件树  │       工作台            │  │   [头像]       │  │
│          │    （打开的文件）        │  │   Agent 名称  │  │
│  [折叠]  │                         │  │   模型信息     │  │
│          │                         │  └───────────────┘  │
│          │                         │  ┌─ 对话区域 ──┐   │
│          │                         │  │ [消息列表]    │  │
│          │                         │  │               │  │
│          │                         │  │ 用户: Hello   │  │
│          │                         │  │ AI: ...       │  │
│          │                         │  │               │  │
│          │                         │  └───────────────┘  │
│          │                         │  ┌─ 输入框 ────┐   │
│          │                         │  │ [输入...]     │  │
│          │                         │  │        [发送] │  │
│          │                         │  └───────────────┘  │
└──────────┴─────────────────────────┴─────────────────────┘
```

**右侧面板** 就是聊天区域：
- 📝 **输入框**：在底部输入框输入消息
- ⌨️ **快捷键**：按 `Enter` 发送，`Shift + Enter` 换行
- 🎯 **实时响应**：AI 回复会实时流式显示
- 🔧 **工具调用**：当 AI 调用工具时，会显示工具状态和结果
- 🧠 **思考过程**：可折叠的推理过程（点击展开/收起）

### 4. 验证功能

#### 测试基础对话
```
输入：你好
期望：AI 实时逐字回复
```

#### 测试工具调用
```
输入：帮我读取 src/main/index.ts 文件的内容
期望：
- 显示 "read" 工具调用（执行中 → 完成）
- 显示工具结果
- AI 根据结果回复
```

#### 测试历史消息
```
1. 发送几条消息
2. 刷新页面（Cmd/Ctrl + R）
3. 期望：历史消息自动加载并正确显示
```

### 5. 检查控制台

打开浏览器开发者工具（`F12` 或 `Cmd+Option+I`），应该看到：

```javascript
// WebSocket 连接成功
[GatewayClient] Connected to ws://127.0.0.1:8765/gateway/ws
[gatewaySetup] Backend ready, connecting to Gateway WebSocket...

// Thread 创建成功
[AgentChatPanel] Thread 已创建: {threadId}

// 历史消息加载
[AgentChatPanel] 已加载 X 条历史事件, Y 条用户消息

// 实时消息接收（发送消息后）
[useStreamWs] 收到消息: { type: 'run:start', ... }
[useStreamWs] 收到消息: { type: 'text:delta', content: '你', ... }
[useStreamWs] 收到消息: { type: 'text:delta', content: '好', ... }
[useStreamWs] 收到消息: { type: 'run:done', ... }
```

### 6. 故障排查

#### WebSocket 连接失败

**症状**：控制台显示 `Connection error`

**解决**：
```bash
# 1. 检查后端是否启动
curl http://127.0.0.1:8765/gateway/health

# 2. 重启应用
pnpm dev
```

#### 没有 AI 响应

**症状**：发送消息后没有任何回复

**排查步骤**：
1. 打开控制台，查看是否有 JavaScript 错误
2. 检查后端日志：
   ```bash
   tail -f logs/app.log
   ```
3. 检查 Provider 配置：
   - 导航到 **设置 → Provider 配置**
   - 确保至少配置了一个 Provider（如 OpenAI）
   - 确认 API Key 正确

#### Thread 创建失败

**症状**：输入框显示"初始化中..."且一直禁用

**解决**：
1. 打开控制台，查看错误信息
2. 检查 Agent 是否存在：
   ```bash
   curl http://127.0.0.1:8765/gateway/agents
   ```
3. 重新加载页面

#### 历史消息不显示

**症状**：刷新页面后历史消息为空

**排查**：
```bash
# 检查 events.jsonl 是否存在
ls -la .home/workspaces/{threadId}/.runtime/events/events.jsonl

# 手动测试 API
curl http://127.0.0.1:8765/gateway/threads/{threadId}/history
```

## 🎨 UI 功能说明

### 消息类型

1. **用户消息**
   - 浅色背景
   - 用户头像图标
   - 纯文本显示

2. **AI 消息**
   - 多块内容组合：
     - 📝 **文本块**：普通回复内容
     - 🧠 **思考块**：可折叠的推理过程（点击展开/收起）
     - 🔧 **工具块**：工具调用信息
       - ⏳ 执行中（旋转图标）
       - ✅ 完成（绿色勾）
       - ❌ 失败（红色警告）
       - ⏸️ 等待审批（暂停图标）

### 工具块详情

点击工具块可以查看：
- **参数**：工具调用时传入的参数（代码块样式）
- **结果**：工具执行返回的结果
- **错误**：工具执行失败的错误信息（红色背景）

### 交互功能

- ✅ 自动滚动到底部
- ✅ 清空对话（点击顶部垃圾桶图标）
- ✅ 折叠/展开思考过程
- ✅ 输入框自动禁用（AI 响应期间）
- ✅ 发送按钮状态管理

## 🔍 技术架构

### 前端入口

```
src/renderer/src/views/AgentWorkspaceView.vue
    ↓ 使用
src/renderer/src/components/workspace/AgentChatPanel.vue
    ↓ 使用
src/renderer/src/components/chat/ChatMessages.vue
    ↓ 使用
MessageItemUser.vue / MessageItemAssistant.vue
    ↓ 使用
Block*.vue (BlockText, BlockThinking, BlockTool)
```

### 关键逻辑

1. **Thread 创建**（`AgentChatPanel.vue:initializeThread()`）
   ```typescript
   // 组件挂载时自动调用
   const result = await gateway.request('chat.createThread', {
     agentId: props.agentId,
     title: '工作区对话'
   });
   threadId.value = result.id;
   ```

2. **历史消息加载**（`AgentChatPanel.vue:loadHistory()`）
   ```typescript
   // Thread 创建后自动调用
   const res = await fetch(`/gateway/threads/${threadId}/history`);
   const { events, userMessages } = await res.json();
   // 遍历 events，在 run:start 前插入用户消息
   ```

3. **实时消息订阅**（`useStreamWs.ts`）
   ```typescript
   // 监听 Gateway WebSocket 事件
   gateway.on('stream:message', (payload) => {
     const msg = payload.message; // 提取 StreamMessage
     // 路由到对应 sessionId 的回调
   });
   ```

4. **消息发送**（`AgentChatPanel.vue:sendMessage()`）
   ```typescript
   // 用户发送消息
   addUserMessage(content);  // 立即显示
   await gateway.request('chat.sendMessage', {
     threadId,
     message: content
   });
   // 后端异步执行，通过 WebSocket 推送结果
   ```

## 📚 相关文档

- [消息展示系统架构](./docs/01-designs/08-chat-message-system-architecture.md)
- [前后端对接文档](./docs/01-designs/09-chat-frontend-backend-integration.md)
- [Gateway RPC 协议](./src/main/common/gateway/README.md)

## 🎯 下一步

现在你已经可以：
1. ✅ 与 AI 进行实时对话
2. ✅ 查看工具调用过程
3. ✅ 查看 AI 的推理过程
4. ✅ 加载历史消息

接下来可以尝试：
- 🚀 发送复杂指令，观察工具调用
- 🎨 自定义 Agent 配置（指令、模型）
- 📂 在工作台中打开文件，让 AI 分析
- 🔧 查看 `.home/workspaces/{threadId}/` 目录的文件结构

**祝你使用愉快！** 🎉
