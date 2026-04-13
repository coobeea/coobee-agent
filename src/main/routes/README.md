# HTTP Routes

Gateway HTTP 路由自动扫描目录，所有 `*Routes.ts` 文件会被自动发现并注册。

## 📁 目录结构

```
src/main/routes/
├── README.md          # 本文档
├── HealthRoutes.ts    # 健康检查路由（示例）
└── ConfigRoutes.ts    # 配置管理路由
```

## 🚀 快速开始

### 添加新的 HTTP 路由

**步骤 1：创建 Routes 文件**

文件命名必须以 `Routes.ts` 结尾，例如 `UserRoutes.ts`：

```typescript
// src/main/routes/UserRoutes.ts
import type Router from '@koa/router';
import { log } from '@main/common/logger';

export function registerUserRoutes(router: Router): void {
  // GET /gateway/users - 获取用户列表
  router.get('/users', async (ctx) => {
    ctx.body = { users: [] };
  });

  // POST /gateway/users - 创建用户
  router.post('/users', async (ctx) => {
    const { name } = ctx.request.body as { name: string };
    ctx.body = { success: true, userId: '123' };
  });

  log.info('[UserRoutes] HTTP 路由注册完成');
}
```

**步骤 2：重启应用**

Gateway 会自动扫描并注册新路由，无需手动导入。

**步骤 3：测试**

```bash
# 测试 GET 请求
curl http://localhost:8765/gateway/users

# 测试 POST 请求
curl -X POST http://localhost:8765/gateway/users \
  -H "Content-Type: application/json" \
  -d '{"name":"张三"}'
```

## 📚 现有路由

### HealthRoutes

提供系统健康检查接口。

**端点：**
- `GET /gateway/system/health` - 系统健康检查
- `GET /gateway/system/info` - 系统信息

**示例：**
```bash
curl http://localhost:8765/gateway/system/health
```

### ConfigRoutes

提供模型供应商配置管理接口。

**端点：**
- `GET /gateway/config/providers` - 获取所有 providers 配置（API Key 脱敏）
- `GET /gateway/config/secrets/status` - 获取 secrets 状态
- `POST /gateway/config/providers/:id/key` - 保存 API Key
- `PATCH /gateway/config/providers/:id` - 更新 provider 配置
- `PUT /gateway/config/providers/:id/enabled` - 切换启用状态
- `POST /gateway/config/providers/:id/test` - 测试连接

**示例：**

```bash
# 获取所有 providers
curl http://localhost:8765/gateway/config/providers

# 保存 API Key
curl -X POST http://localhost:8765/gateway/config/providers/dashscope/key \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"sk-your-key-here"}'

# 启用 provider
curl -X PUT http://localhost:8765/gateway/config/providers/dashscope/enabled \
  -H "Content-Type: application/json" \
  -d '{"enabled":true}'

# 测试连接
curl -X POST http://localhost:8765/gateway/config/providers/dashscope/test
```

**前端使用：**

参考 `src/renderer/src/api/config.ts` 中的封装方法：

```typescript
import { getProviders, saveProviderKey, toggleProvider } from '@/api/config';

// 获取所有 providers
const result = await getProviders();
if (result.success) {
  console.log(result.data);
}

// 保存 API Key
await saveProviderKey('dashscope', 'sk-your-key-here');

// 启用 provider
await toggleProvider('dashscope', true);
```

## 🔧 路由规范

### 文件命名约定

- **命名格式**：`*Routes.ts`（必须以 `Routes.ts` 结尾）
- **导出格式**：`export function register{Name}Routes(router: Router)`
- **位置**：`src/main/routes/` 目录下

### 响应格式规范

**成功响应：**
```json
{
  "success": true,
  "data": { /* 返回数据 */ }
}
```

**错误响应：**
```json
{
  "success": false,
  "error": "错误信息"
}
```

**HTTP 状态码：**
- `200` - 成功
- `400` - 请求参数错误
- `404` - 资源不存在
- `500` - 服务器错误

### 日志规范

每个 Routes 文件应在注册完成时输出日志：

```typescript
log.info('[{Name}Routes] HTTP 路由注册完成');
```

## 🌐 网络端点信息

- **服务器地址**：`http://localhost:8765`（默认）
- **路由前缀**：`/gateway`
- **WebSocket**：`ws://localhost:8765/gateway/ws`
- **配置方式**：通过环境变量 `VITE_SERVER_PORT` 修改端口

## 🔍 调试

查看路由注册日志：

```
[Gateway] HTTP 路由发现完成: 共 2 个
[HealthRoutes] HTTP 路由注册完成
[ConfigRoutes] HTTP 路由注册完成
```

## 📝 最佳实践

1. **参数验证**：始终验证请求参数的类型和有效性
2. **错误处理**：使用 try-catch 捕获错误并返回统一格式
3. **日志记录**：记录关键操作和错误信息
4. **类型安全**：使用 TypeScript 类型定义请求和响应
5. **RESTful 设计**：遵循 REST 规范（GET 查询、POST 创建、PUT/PATCH 更新、DELETE 删除）

## 🔗 相关文档

- Gateway 架构：`src/main/common/gateway/README.md`
- 配置管理：`src/main/config/README.md`
- 前端 API：`src/renderer/src/api/config.ts`
