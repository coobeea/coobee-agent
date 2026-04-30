# Extension 系统

Extension 是动态可插拔的功能模块，可以注册工具（Tool）、生命周期钩子（Hook）、Gateway 方法、Channel、HTTP 路由、后台服务，也可以贡献 Skill。

## 两级加载（按优先级从低到高）

- **builtin** — `resources/extensions/`。内置，随应用分发，只读。
- **user** — `.home/extensions/`。用户安装或编写。

同 ID 高优先级覆盖低优先级。历史上曾有"workspace 级热加载"的设想，当前实现不再注入 workspace 级路径，`{workspace}/extensions/` 下的内容不会被自动加载，不要依赖。

写新 Extension 就放在 `.home/extensions/{ext-id}/`。

## 目录最小结构

```
{ext-id}/
├── extension.json        必需 — 清单
└── index.ts              可选 — 代码入口（纯 Skill 扩展可省略）
```

## extension.json

```json
{
  "id": "my-ext",
  "name": "My Extension",
  "version": "1.0.0",
  "description": "扩展描述",
  "skills": "skills"
}
```

`skills` 字段指向同目录下的 skills 子目录，注册后其 SKILL.md 会并入 `skill_search_paths`（来源 kind = `extension`）。

## 代码能力

`index.ts` 导出默认模块（ExtensionModule）。在 `register(api)` 中可以：

- `api.registerTool({...})` — 注册新工具，LLM 可通过 function call 调用
- `api.registerGatewayMethod('id', handler)` — 注册 RPC 方法，前端可调
- `api.registerChannel({...})` — 注册 Channel，对接外部系统
- `api.registerHttpRoute({...})` — 注册 HTTP 路由
- `api.registerService({id, start, stop})` — 注册长期运行的后台服务
- `api.on('hook_name', handler)` — 订阅 Agent 生命周期钩子

骨架：

```typescript
import type { ExtensionModule } from '@main/extension';

export default {
  id: 'my-ext',
  name: 'My Extension',
  register(api) {
    api.registerTool({
      name: 'my_tool',
      description: '...',
      parameters: {
        /* JSON Schema */
      },
      execute: async (params) => {
        /* ... */
      }
    });

    api.on('before_agent_start', async (event) => {
      // ...
    });
  }
} as ExtensionModule;
```

## 纯 Skill 扩展

没有代码、只贡献 Skill 的扩展可省略 `index.ts`：

```
{ext-id}/
├── extension.json        含 "skills": "skills"
└── skills/
    ├── skill-a/SKILL.md
    └── skill-b/SKILL.md
```

## 给 Agent 的操作建议

Extension 是偏重型的动作，通常由用户/开发者编写，不建议你（Agent）在运行时自己去写 `.home/extensions/` 下的 index.ts。

如果确实需要新增能力，先判断：

- 只想告诉未来的自己"遇到某场景该怎么做" → 写 Skill，不是 Extension
- 想注册一个新工具给 LLM 调 → 要写 Extension，但这通常应当拆成独立 POC 由用户审核

如果要读取已加载的 Extension 信息，看 `<runtime_environment>` 中的 `extensions` 字段（当前会话已加载的 id 列表）。

## 注意事项

一、Extension id 全局唯一，重复加载会被高优先级覆盖。

二、不要在 Extension 里自行发起网络请求到外部服务，除非用户明确同意。

三、Extension 的生命周期钩子里抛异常会影响主流程，写的时候兜住所有异常。
