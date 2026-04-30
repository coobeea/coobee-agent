# 智能体导入导出 ZIP 包格式设计

> 日期：2026-04-15  
> 版本：v1.0  
> 状态：设计方案

## 概述

为了方便智能体的分享和迁移，我们需要设计一个标准的 ZIP 包格式，用于导入和导出智能体配置及其相关文件。

## 设计目标

1. **简洁易懂**：目录结构清晰，便于手动编辑和理解
2. **完整性**：包含所有必要的配置和文件
3. **可扩展性**：支持未来添加新的元数据和资源
4. **兼容性**：与现有的 AgentHomeManager 结构保持一致
5. **可移植性**：可以在不同环境间迁移

## ZIP 包结构

### 推荐方案（扁平化结构）

```
agent-{name}.zip
├── manifest.json        # 包元信息（版本、导出时间等）
├── agent.json           # 智能体核心配置
├── IDENTITY.md          # 身份名片（可选）
├── SOUL.md              # 人格灵魂（可选）
├── USER.md              # 主人档案（可选）
├── NOTES.md             # 环境工具备注（可选）
├── HEARTBEAT.md         # 心跳任务清单（可选）
├── AGENTS.md            # Agent 级规则和技能配置（可选）
└── skills/              # 专属技能目录（可选）
    ├── skill-1/
    │   └── SKILL.md
    └── skill-2/
        └── SKILL.md
```

### 文件说明

#### 1. `manifest.json` - 包元信息

```json
{
  "formatVersion": "1.0",
  "exportedAt": "2026-04-15T10:30:00.000Z",
  "exportedBy": "coobee-agent",
  "appVersion": "1.0.0"
}
```

**字段说明：**
- `formatVersion`: ZIP 包格式版本（用于向后兼容）
- `exportedAt`: 导出时间戳
- `exportedBy`: 导出应用标识
- `appVersion`: 应用版本号

#### 2. `agent.json` - 智能体核心配置

```json
{
  "id": "agent-abc123",
  "name": "我的智能助手",
  "description": "一个专注于代码开发的智能助手",
  "instructions": "你是一个专业的代码助手...",
  "model": "",
  "skills": [],
  "excludeTools": [],
  "createdBy": "user",
  "metadata": {
    "author": "用户名",
    "tags": ["coding", "assistant"],
    "avatar": "🤖"
  }
}
```

**字段说明：**
- `id`: 智能体 ID（导入时可以重新生成）
- `name`: 智能体名称（必填）
- `description`: 智能体描述（必填）
- `instructions`: 系统提示词（可选，如果为空则使用 SOUL.md）
- `model`: 使用的模型 ID 或模型组引用
- `skills`: 关联的技能列表
- `excludeTools`: 排除的工具列表
- `createdBy`: 创建来源（导入时统一设为 "user"）
- `metadata`: 扩展元数据（可选）
  - `author`: 作者信息
  - `tags`: 标签
  - `avatar`: 头像 emoji 或图片路径

#### 3. 人格文件（可选）

所有人格文件都是可选的，遵循 AgentHomeManager 的结构：

- **IDENTITY.md**: 身份名片（名字、风格、签名）
- **SOUL.md**: 核心灵魂（行为原则、风格定调）
- **USER.md**: 主人档案（用户称呼、偏好）
- **NOTES.md**: 环境工具备注（特殊配置）
- **HEARTBEAT.md**: 心跳任务清单（定期任务）
- **AGENTS.md**: Agent 级规则和技能配置

#### 4. `skills/` - 专属技能目录（可选）

```
skills/
├── my-custom-skill/
│   └── SKILL.md
└── another-skill/
    └── SKILL.md
```

每个技能一个独立目录，包含 `SKILL.md` 文件。

## 导入流程设计

### 1. 解压和验证

```typescript
interface ImportResult {
  success: boolean;
  agentId?: string;
  error?: string;
  warnings?: string[];
}
```

1. 解压 ZIP 文件到临时目录
2. 验证必需文件：
   - `manifest.json` 存在且格式有效
   - `agent.json` 存在且包含必填字段（name, description）
3. 检查格式版本兼容性

### 2. ID 冲突处理

导入时需要处理 ID 冲突的情况：

**策略 1：自动重命名（推荐）**
```typescript
// 如果 ID 已存在，自动生成新 ID
if (agentStore.has(importedAgent.id)) {
  const newId = generateAgentId(importedAgent.name); // 基于名称生成
  importedAgent.id = newId;
  warnings.push(`智能体 ID 冲突，已重新生成为: ${newId}`);
}
```

**策略 2：提示用户选择**
- 覆盖现有智能体
- 保留两者（自动重命名）
- 取消导入

### 3. 导入数据

```typescript
async function importAgent(zipPath: string): Promise<ImportResult> {
  // 1. 解压到临时目录
  const tempDir = await unzipToTemp(zipPath);
  
  // 2. 读取并验证 manifest
  const manifest = JSON.parse(fs.readFileSync(path.join(tempDir, 'manifest.json')));
  validateManifest(manifest);
  
  // 3. 读取 agent.json
  const agentConfig = JSON.parse(fs.readFileSync(path.join(tempDir, 'agent.json')));
  validateAgentConfig(agentConfig);
  
  // 4. 处理 ID 冲突
  const finalAgentId = resolveIdConflict(agentConfig.id, agentConfig.name);
  
  // 5. 创建智能体
  await agentStore.create({
    ...agentConfig,
    id: finalAgentId,
    createdBy: 'user'
  });
  
  // 6. 复制人格文件
  const personalityFiles = ['IDENTITY.md', 'SOUL.md', 'USER.md', 'NOTES.md', 'HEARTBEAT.md', 'AGENTS.md'];
  for (const file of personalityFiles) {
    const filePath = path.join(tempDir, file);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      agentHomeManager.writeFile(finalAgentId, file, content);
    }
  }
  
  // 7. 复制技能文件（如果存在）
  const skillsDir = path.join(tempDir, 'skills');
  if (fs.existsSync(skillsDir)) {
    const targetSkillsDir = path.join(agentHomeManager.getHomePath(finalAgentId), 'skills');
    fs.cpSync(skillsDir, targetSkillsDir, { recursive: true });
  }
  
  // 8. 清理临时文件
  fs.rmSync(tempDir, { recursive: true });
  
  return { success: true, agentId: finalAgentId };
}
```

## 导出流程设计

### 导出逻辑

```typescript
async function exportAgent(agentId: string): Promise<string> {
  const agent = await agentStore.get(agentId);
  if (!agent) throw new Error('Agent not found');
  
  // 1. 创建临时目录
  const tempDir = path.join(tmpdir(), `agent-export-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });
  
  // 2. 写入 manifest.json
  const manifest = {
    formatVersion: '1.0',
    exportedAt: new Date().toISOString(),
    exportedBy: 'coobee-agent',
    appVersion: app.getVersion()
  };
  fs.writeFileSync(
    path.join(tempDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
  
  // 3. 写入 agent.json（移除时间戳和版本号）
  const exportConfig = {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    instructions: agent.instructions,
    model: agent.model,
    skills: agent.skills,
    excludeTools: agent.excludeTools,
    createdBy: agent.createdBy,
    metadata: agent.metadata
  };
  fs.writeFileSync(
    path.join(tempDir, 'agent.json'),
    JSON.stringify(exportConfig, null, 2)
  );
  
  // 4. 复制人格文件
  const homeDir = agentHomeManager.getHomePath(agentId);
  const personalityFiles = ['IDENTITY.md', 'SOUL.md', 'USER.md', 'NOTES.md', 'HEARTBEAT.md', 'AGENTS.md'];
  for (const file of personalityFiles) {
    const srcPath = path.join(homeDir, file);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, path.join(tempDir, file));
    }
  }
  
  // 5. 复制技能目录（如果存在且非空）
  const skillsDir = path.join(homeDir, 'skills');
  if (fs.existsSync(skillsDir) && fs.readdirSync(skillsDir).length > 0) {
    const targetSkillsDir = path.join(tempDir, 'skills');
    fs.cpSync(skillsDir, targetSkillsDir, { recursive: true });
  }
  
  // 6. 打包成 ZIP
  const zipPath = path.join(tmpdir(), `${sanitizeFilename(agent.name)}.zip`);
  await zipDirectory(tempDir, zipPath);
  
  // 7. 清理临时目录
  fs.rmSync(tempDir, { recursive: true });
  
  return zipPath;
}
```

## UI 设计建议

### 导入界面

```
┌─────────────────────────────────────┐
│  导入智能体                         │
├─────────────────────────────────────┤
│                                     │
│  📦 选择 ZIP 文件                   │
│  ┌─────────────────────────────┐   │
│  │  agent-assistant.zip        │   │
│  │  (点击选择或拖拽文件)        │   │
│  └─────────────────────────────┘   │
│                                     │
│  智能体信息预览：                   │
│  ┌─────────────────────────────┐   │
│  │  名称：我的助手               │   │
│  │  描述：专业的代码助手         │   │
│  │  人格文件：5 个              │   │
│  │  技能：2 个                  │   │
│  └─────────────────────────────┘   │
│                                     │
│  ⚠️ ID 冲突处理：                  │
│  ( ) 自动重命名（推荐）             │
│  ( ) 覆盖现有智能体                 │
│                                     │
│  [取消]           [开始导入]       │
└─────────────────────────────────────┘
```

### 导出界面

```
┌─────────────────────────────────────┐
│  导出智能体                         │
├─────────────────────────────────────┤
│                                     │
│  选择智能体：                       │
│  ┌─────────────────────────────┐   │
│  │  🤖 我的助手                │   │
│  └─────────────────────────────┘   │
│                                     │
│  导出内容：                         │
│  ☑ 基本配置                        │
│  ☑ 人格文件 (6 个)                 │
│  ☑ 专属技能 (2 个)                 │
│  ☐ 会话记录（不推荐）               │
│                                     │
│  保存位置：                         │
│  ┌─────────────────────────────┐   │
│  │  ~/Downloads/               │   │
│  └─────────────────────────────┘   │
│                                     │
│  [取消]           [导出]           │
└─────────────────────────────────────┘
```

## 未来扩展

### 1. 版本兼容性

当格式版本升级时，需要提供迁移逻辑：

```typescript
function migrateFormat(manifest: any, data: any): any {
  switch (manifest.formatVersion) {
    case '1.0':
      return data; // 当前版本，无需迁移
    case '0.9':
      return migrateFrom0_9To1_0(data);
    default:
      throw new Error(`Unsupported format version: ${manifest.formatVersion}`);
  }
}
```

### 2. 资源文件支持

未来可以支持导出更多资源：

```
agent.zip
├── manifest.json
├── agent.json
├── ...
└── assets/              # 新增资源目录
    ├── avatar.png       # 头像图片
    ├── background.jpg   # 背景图片
    └── sounds/          # 音效文件
        └── greeting.mp3
```

### 3. 批量导入/导出

支持一次性导入或导出多个智能体：

```
agents-bundle.zip
├── manifest.json        # 包含多个智能体的清单
├── agent-1/
│   ├── agent.json
│   ├── SOUL.md
│   └── ...
└── agent-2/
    ├── agent.json
    ├── SOUL.md
    └── ...
```

## 实现清单

- [ ] 创建 `AgentImportExport` 工具类
- [ ] 实现 ZIP 文件解压和打包功能（使用 `adm-zip`）
- [ ] 实现导入验证逻辑
- [ ] 实现 ID 冲突处理
- [ ] 添加后端 API 路由：
  - `POST /gateway/agents/import` - 导入智能体
  - `GET /gateway/agents/:id/export` - 导出智能体
- [ ] 实现前端导入/导出 UI
- [ ] 添加拖拽上传支持
- [ ] 编写单元测试
- [ ] 更新用户文档

## 参考

- AgentHomeManager 结构：`src/main/agent/agents/AgentHomeManager.ts`
- Agent 类型定义：`src/main/agent/agents/types.ts`
- Skill 系统文档：待补充
