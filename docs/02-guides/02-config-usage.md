# 配置系统使用指南

> 日期：2026-04-16
> 版本：v1.0
> 状态：✅ 当前推荐方案

## 概述

Coobee Agent 使用分层的配置系统，确保配置的一致性和易用性。

## 配置文件结构

```
.home/config/
├── coobee.json5       # 主配置文件（用户配置）
├── providers.json5    # Provider 详细信息（模型列表、API 地址）
└── secrets.json5      # 敏感信息（API Keys）
```

## 统一访问接口

### 1. ConfigStore - 主配置

```typescript
import { ConfigStore } from '@main/common/config';

// 获取完整配置
const config = ConfigStore.getInstance().getAll();

// 获取特定配置节
const uiConfig = ConfigStore.getInstance().get('ui');
const modelsConfig = ConfigStore.getInstance().get('models');
```

### 2. Providers - Provider 配置

```typescript
import { Providers } from '@main/config';

// 获取所有 Provider
const allProviders = Providers.getAll();

// 获取单个 Provider
const ollama = Providers.getProvider('ollama');
// 返回: { id, name, baseUrl, apiKey, models: [...] }

// 获取已启用的 Provider
const enabled = Providers.getEnabled();

// 获取 Provider 的模型列表
const models = Providers.getModels('ollama');

// 检查 Provider 是否启用
const isEnabled = Providers.isEnabled('ollama');
```

### 3. Models - 统一的模型解析服务 ⭐️

**核心服务**，连接主配置和 Providers 配置：

```typescript
import { Models } from '@main/config';

// 获取全局默认模型
const defaultModel = Models.getDefaultModel();
// 返回: 'ollama/gemma4:e4b'

// 解析模型（获取完整信息）
const { provider, model, fullSpec } = Models.resolveModel('ollama/qwen3.5:9b');

// provider 包含：
// - id: 'ollama'
// - name: 'Ollama'
// - baseUrl: 'http://127.0.0.1:11434/v1'
// - apiKey: 'ollama'
// - api: 'openai-compatible'

// model 包含：
// - id: 'qwen3.5:9b'
// - name: 'Qwen3.5 9B'
// - contextWindow: 32768
// - maxOutputTokens: 8192
// - reasoning: true

// 如果不指定模型，使用全局默认
const resolved = Models.resolveModel();
// 等价于: Models.resolveModel(Models.getDefaultModel())

// 验证模型是否有效
const isValid = Models.isValidModel('ollama/qwen3.5:9b');

// 列出所有可用模型
const allModels = Models.listAllModels();
// 返回: ['ollama/qwen3.5:9b', 'ollama/gemma4:e4b', ...]

// 获取推荐模型列表（已启用的 Provider 的模型）
const recommended = Models.getRecommendedModels();
```

## 使用场景

### 场景 1：Agent 执行时选择模型

```typescript
import { Models } from '@main/config';

class AgentExecutor {
  async execute(options: { model?: string }) {
    // 模型优先级：options.model > agent.model > 全局默认
    const modelSpec = options.model || this.agent.model || null;
    
    // 解析模型（自动使用默认）
    const { provider, model } = Models.resolveModel(modelSpec);
    
    // 使用完整信息调用 LLM
    const response = await this.callLLM({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: model.id,
      maxTokens: model.maxOutputTokens
    });
  }
}
```

### 场景 2：API 路由中使用

```typescript
import { Models } from '@main/config';

router.post('/chat/threads/:id/messages', async (ctx) => {
  const thread = await threadStore.get(ctx.params.id);
  const agent = await agentStore.get(thread.agentId);
  
  // 优先级：thread.overrideModel > agent.model > 全局默认
  const modelSpec = thread.overrideModel || agent.model || null;
  
  // 解析模型
  const { provider, model } = Models.resolveModel(modelSpec);
  
  // 使用...
});
```

### 场景 3：前端获取可用模型列表

```typescript
import { Providers } from '@main/config';

router.get('/models', async (ctx) => {
  // 获取所有已启用的 Provider 及其模型
  const providers = Providers.getEnabled();
  
  const modelList = providers.flatMap(provider => 
    provider.models.map(model => ({
      spec: `${provider.id}/${model.id}`,
      providerName: provider.name,
      modelName: model.name,
      features: model.features
    }))
  );
  
  ctx.body = { success: true, data: modelList };
});
```

### 场景 4：验证用户输入的模型

```typescript
import { Models } from '@main/config';

function validateModelInput(modelSpec: string): boolean {
  try {
    Models.resolveModel(modelSpec);
    return true;
  } catch (error) {
    console.error(`无效的模型: ${modelSpec}`, error.message);
    return false;
  }
}
```

## 配置优先级

### 模型选择优先级

```
1. Thread.overrideModel     (会话级覆盖)
   ↓
2. Agent.model              (Agent 默认模型)
   ↓
3. config.models.defaults.model.primary  (全局默认)
```

### API Key 优先级

```
1. providers.json5 中的 apiKey
   ↓
2. secrets.json5 中的 API Key
   ↓
3. 环境变量 (OLLAMA_API_KEY, {PROVIDER_ID}_API_KEY)
```

## 设计原则

1. **按需引用，而非依赖注入**
   - 需要配置的地方直接 `import`
   - 不通过 `setXxx()` 注入

2. **统一访问接口**
   - `ConfigStore`: 主配置
   - `Providers`: Provider 配置
   - `Models`: 模型解析（连接两者）

3. **引用一致性**
   - 所有模块使用相同的方式访问配置
   - 不同的访问路径，相同的结果

4. **自动初始化**
   - 启动时自动扫描配置模块
   - 无需手动注册

## 常见问题

### Q: 如何添加新的 Provider？

在 `.home/config/providers.json5` 中添加：

```json5
{
  "my-provider": {
    "id": "my-provider",
    "name": "My Provider",
    "baseUrl": "https://api.example.com",
    "apiKey": "",  // 在 secrets.json5 中配置
    "enabled": true,
    "models": [
      {
        "id": "model-1",
        "name": "Model 1",
        // ...
      }
    ]
  }
}
```

### Q: 如何更改默认模型？

修改 `.home/config/coobee.json5`:

```json5
{
  "models": {
    "defaults": {
      "model": {
        "primary": "ollama/qwen3.5:9b"  // 改为你想要的模型
      }
    }
  }
}
```

### Q: 配置修改后需要重启吗？

不需要！配置系统支持热重载：

- 修改 `coobee.json5` → 自动重载
- 修改 `providers.json5` → 自动重载
- 修改 `secrets.json5` → 自动重载

## 相关文档

- [配置文件结构](./01-config-structure.md)
- [Chat API 数据流](../01-designs/05-chat-api-data-flow.md)
