# Composables 使用指南

## 🎯 useGateway

Vue 友好的 Gateway WebSocket 封装，提供自动生命周期管理。

### 📦 基本用法

```vue
<script setup lang="ts">
import { useGateway } from '@/composables/useGateway';

const { connectionState, lastError, on, request } = useGateway();

// 监听事件（组件卸载时自动清理）
on('stream:message', (payload) => {
  console.log('收到 Stream 消息:', payload);
});

on('worker:status', (payload) => {
  console.log('Worker 状态更新:', payload);
});
</script>

<template>
  <div>
    <div>连接状态: {{ connectionState }}</div>
    <div v-if="lastError" class="error">{{ lastError }}</div>
  </div>
</template>
```

### 🚀 高级用法

#### 1️⃣ 发送 RPC 请求

```typescript
const { request } = useGateway();

// 调用后端 HTTP Routes
async function loadWorkers() {
  try {
    const workers = await request<Worker[]>('worker.list');
    console.log('Worker 列表:', workers);
  } catch (error) {
    console.error('请求失败:', error);
  }
}
```

#### 2️⃣ 监听连接状态

```typescript
const { onConnect } = useGateway();

// 连接成功后自动加载数据
onConnect(() => {
  console.log('Gateway 已连接，开始加载数据...');
  loadInitialData();
});
```

#### 3️⃣ 结合 Vue 响应式

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { useGateway } from '@/composables/useGateway';

const messages = ref<any[]>([]);
const { connectionState, on } = useGateway();

// 监听消息并更新响应式数据
on('stream:message', (payload: any) => {
  messages.value.push(payload);
});
</script>

<template>
  <div>
    <div class="status">{{ connectionState }}</div>
    <div v-for="msg in messages" :key="msg.id">
      {{ msg.content }}
    </div>
  </div>
</template>
```

---

## 📋 可用事件列表

根据 `src/main/publishers/` 配置，以下事件会自动推送到前端：

### Stream 事件（StreamPublisher.ts）
- `stream:message` - Stream 消息
- `stream:start` - Stream 开始
- `stream:end` - Stream 结束
- `stream:error` - Stream 错误

### Worker 事件（WorkerPublisher.ts）
- `worker:status` - Worker 状态变更
- `worker:progress` - Worker 进度更新
- `worker:error` - Worker 错误

---

## 🔄 与直接使用 gateway 的对比

### 直接使用 gateway（需要手动清理）

```typescript
import { gateway } from '@/plugins/gatewaySetup';
import { onUnmounted } from 'vue';

// ❌ 需要手动管理清理
const off = gateway.on('stream:message', handler);
onUnmounted(() => {
  off(); // 必须手动清理
});
```

### 使用 useGateway（自动清理）

```typescript
import { useGateway } from '@/composables/useGateway';

// ✅ 自动清理，无需手动处理
const { on } = useGateway();
on('stream:message', handler);
// 组件卸载时自动清理
```

---

## 🎯 选择建议

| 场景 | 推荐方案 |
|------|----------|
| 在 Vue 组件中使用 | ✅ `useGateway()` |
| 在全局插件/store 中使用 | ✅ `gateway` 单例 |
| 需要跨组件共享连接 | ✅ `gateway` 单例 |
| 需要自动生命周期管理 | ✅ `useGateway()` |

---

## 🔗 相关文件

- **GatewayClient 实现**: `src/renderer/src/services/GatewayClient.ts`
- **全局单例导出**: `src/renderer/src/plugins/gatewaySetup.ts`
- **后端事件配置**: `src/main/publishers/*Publisher.ts`
- **协议定义**: `src/shared/gateway-protocol.ts`
