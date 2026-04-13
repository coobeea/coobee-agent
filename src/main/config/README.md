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
├── threads.ts          # Thread/工作空间配置路径
├── shared-drive.ts     # 共享存储配置
├── providers.ts        # Provider 配置加载/管理
└── default-template.ts # 默认配置模板（首次启动生成 coobee.json5）
```

## 模块说明

### 配置模块

- **Agents** - Agent 定义路径（builtin/agents、.home/agents）
- **Skills** - Skill 路径（builtin/skills、user/skills）
- **Extensions** - Extension 路径
- **Workers** - Worker 相关路径（scripts、envs、models）
- **Threads** - Thread 元数据和工作空间路径
- **SharedDrive** - 共享存储路径
- **Providers** - AI 模型 Provider 配置加载与管理
- **DefaultTemplate** - 默认配置模板生成器

**配置文件**：
- `.home/config/providers.json5` - Provider 配置（推荐）
- `.home/config/coobee.json5` - 主配置（兼容，从 `models.providers` 读取）

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

### DefaultTemplate 模块

**功能**：生成默认的 `coobee.json5` 配置文件

**文件**：
- `default-template.ts` - 读取默认配置模板的工具函数
- `default-config.json5` - 默认配置模板文件（1000+ 行）

**用途**：
- 首次启动时自动创建配置文件
- 包含所有预置的 AI 模型供应商配置（API Key 为空，默认禁用）
- 用户只需填入 API Key 并启用即可使用

**使用**：
```typescript
import { generateDefaultConfig } from '@main/config/default-template';

// 获取默认配置内容（JSON5 格式字符串）
const configContent = generateDefaultConfig();
```

**注意**：
- 配置模板使用独立的 `.json5` 文件，便于维护和编辑
- 构建时会自动复制到 `out/main/config/` 目录（通过 electron-vite 插件）

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

## 注意事项

1. **文件位置**：业务配置文件应放在 `src/main/config/`，通用配置工具放在 `src/main/common/config/`
2. **命名规范**：配置模块使用单数或复数名词（如 `threads.ts`、`providers.ts`），与业务概念对应
3. **导出规范**：统一从 `index.ts` 导出，使用 PascalCase 命名（如 `Threads`、`Providers`）
