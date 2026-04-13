# Config 模块

业务配置管理模块，为各业务模块提供统一的配置路径和加载接口。

## 目录结构

```
src/main/config/
├── README.md           # 本文件
├── index.ts            # 统一导出
├── agents.ts           # Agent 配置路径
├── skills.ts           # Skill 配置路径
├── extensions.ts       # Extension 配置路径
├── workers.ts          # Worker 配置路径
├── sessions.ts         # Session 配置路径
├── shared-drive.ts     # 共享存储配置
└── providers.ts        # Provider 配置（新增）
```

## 模块说明

### 现有模块

- **Agents** - Agent 定义路径（builtin/agents、.home/agents）
- **Skills** - Skill 路径（builtin/skills、user/skills）
- **Extensions** - Extension 路径
- **Workers** - Worker 相关路径（scripts、envs、models）
- **Sessions** - Session 工作区路径
- **SharedDrive** - 共享存储路径

### 新增模块：Providers

**功能**：管理 AI 模型 Provider 配置

**配置文件**：
- `.home/config/providers.json5` - Provider 配置（推荐）
- `.home/config/coobee.json5` - 主配置（兼容模式）

**使用示例**：

```typescript
import { Providers } from '@main/config';

// 加载配置
const config = Providers.load(configDir, secretsDir);

// 保存配置
Providers.save(config, configDir, secretsDir);

// 清除缓存
Providers.clearCache();
```

## 设计原则

1. **业务配置分离**：每个业务模块一个配置文件
2. **路径统一管理**：所有路径通过此模块提供
3. **易于扩展**：新增业务只需添加新的配置文件
4. **保持通用层纯净**：`common/config` 只包含基础设施

## 与 common/config 的区别

| 目录 | 职责 | 示例 |
|------|------|------|
| `common/config/` | 通用配置基础设施 | ConfigStore, ConfigLoader, Schema |
| `main/config/` | 业务配置管理 | Agents, Skills, Providers |

## Provider 配置迁移

如需将 Provider 配置从 `coobee.json5` 独立出来，运行迁移脚本：

```bash
pnpm tsx scripts/migrate-providers.ts
```

详细说明请查看：
- [Provider 配置迁移指南](../../docs/02-guides/01-provider-config-migration.md)
- [Provider 快速开始](../../docs/02-guides/02-provider-quickstart.md)
