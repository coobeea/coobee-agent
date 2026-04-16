# Agent Import Package Specification

> **Skill Type**: Development Standard  
> **Version**: 1.0  
> **Last Updated**: 2026-04-15

## 📋 概述

本规范定义了 Coobee Agent 智能体导入包的标准结构和制作流程。当你需要帮助用户创建智能体导入包时，必须严格遵循此规范。

**关键原则：**
- 使用标准 ZIP 格式
- 包含必需的元信息文件
- 遵循固定的目录结构
- 确保跨平台兼容性

## 📦 标准 ZIP 包结构

### 完整结构示例

```
agent-{name}.zip
├── manifest.json        # 包元信息（必需）
├── agent.json           # 智能体配置（必需）
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

### 文件结构说明

**必需文件：**
1. `manifest.json` - 包元信息和格式版本
2. `agent.json` - 智能体核心配置

**可选文件：**
3. `IDENTITY.md`, `SOUL.md`, `USER.md`, `NOTES.md`, `HEARTBEAT.md`, `AGENTS.md` - 人格文件
4. `skills/` - 专属技能目录

## 📄 文件格式规范

### 1. manifest.json（必需）

包含 ZIP 包的元信息，用于版本兼容性检查。

**格式：**
```json
{
  "formatVersion": "1.0",
  "exportedAt": "2026-04-15T10:30:00.000Z",
  "exportedBy": "coobee-agent",
  "appVersion": "1.0.0"
}
```

**字段说明：**
- `formatVersion` (string, 必需): ZIP 包格式版本，当前为 `"1.0"`
- `exportedAt` (string, 必需): ISO 8601 格式的导出时间戳
- `exportedBy` (string, 必需): 导出应用标识，固定为 `"coobee-agent"`
- `appVersion` (string, 必需): 应用版本号

**生成示例：**
```javascript
const manifest = {
  formatVersion: "1.0",
  exportedAt: new Date().toISOString(),
  exportedBy: "coobee-agent",
  appVersion: "1.0.0"
};

fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2), 'utf-8');
```

### 2. agent.json（必需）

智能体的核心配置文件，包含所有基本信息和设置。

**格式：**
```json
{
  "id": "agent-abc123",
  "name": "我的智能助手",
  "description": "一个专注于代码开发的智能助手",
  "instructions": "你是一个专业的代码助手...",
  "model": "@group:default",
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

**基本信息（必需）：**
- `id` (string): 智能体唯一标识符
  - 格式：`agent-{slug}`
  - 允许字符：小写字母、数字、连字符、下划线
  - 示例：`agent-code-helper`, `agent-my-assistant`
  
- `name` (string): 智能体名称
  - 用户友好的显示名称
  - 长度：1-100 字符
  
- `description` (string): 智能体描述
  - 简要说明智能体的功能和用途
  - 长度：1-500 字符

**核心配置：**
- `instructions` (string): 系统提示词
  - 如果为空或省略，系统会使用 `SOUL.md` 的内容
  - 如果两者都为空，系统使用默认值：`"你是一个智能助手。"`
  
- `model` (string, 可选): 使用的模型
  - 模型组引用：`@group:default`, `@group:fast`, `@group:smart`
  - 直接模型 ID：`gpt-4`, `claude-3-opus`
  
- `skills` (array, 可选): 关联的技能列表
  - 格式：`["skill-name-1", "skill-name-2"]`
  
- `excludeTools` (array, 可选): 排除的工具黑名单
  - 格式：`["tool-1", "tool-2"]`

**元数据：**
- `createdBy` (string): 创建来源
  - 允许值：`"user"`, `"agent"`, `"system"`
  - 导入的智能体统一使用 `"user"`
  
- `metadata` (object, 可选): 扩展元数据
  - `author` (string): 作者信息
  - `tags` (array): 标签列表
  - `avatar` (string): 头像 emoji 或图片路径
  - 其他自定义字段

**生成示例：**
```javascript
const agentConfig = {
  id: "agent-my-assistant",
  name: "我的助手",
  description: "一个多功能智能助手",
  instructions: "你是一个专业、高效的智能助手。",
  model: "@group:default",
  skills: [],
  excludeTools: [],
  createdBy: "user",
  metadata: {
    author: "用户名",
    tags: ["general", "assistant"],
    avatar: "🤖"
  }
};

fs.writeFileSync('agent.json', JSON.stringify(agentConfig, null, 2), 'utf-8');
```

### 3. 人格文件（可选）

人格文件是 Markdown 格式的文本文件，用于定义智能体的身份、性格和行为规则。

**文件清单：**

#### IDENTITY.md - 身份名片
定义智能体的基本身份信息。

**模板：**
```markdown
# Identity

<!-- 你的身份名片 -->
<!-- Name: (智能体的名字) -->
<!-- Vibe: (风格，如温和/严肃/活泼) -->
<!-- Emoji: (签名 emoji) -->
```

**示例：**
```markdown
# Identity

Name: 小智
Vibe: 专业、高效、友好
Emoji: 🤖
```

#### SOUL.md - 人格灵魂（核心文件）
定义智能体的核心性格、行为原则和风格定调。

**模板：**
```markdown
# Soul

<!-- 你的人格灵魂。核心原则、行为边界、风格定调。 -->
<!-- 这个文件定义了智能体的核心性格和行为准则。 -->
```

**示例：**
```markdown
# Soul

## 核心原则

你是一个专业的代码助手，遵循以下原则：

1. **准确性优先**：确保代码的正确性和可靠性
2. **最佳实践**：遵循行业标准和最佳实践
3. **清晰沟通**：用简洁明了的语言解释技术概念
4. **持续学习**：保持对新技术的好奇心

## 行为风格

- 回答问题时先理解需求，再给出解决方案
- 提供代码时包含必要的注释
- 遇到不确定的问题，主动说明并建议验证方法
```

#### USER.md - 主人档案
记录用户的相关信息和偏好。

**模板：**
```markdown
# User

<!-- 主人档案：了解你的用户 -->
<!-- 称呼: (用户的称呼) -->
<!-- 主要用途: (使用场景) -->
<!-- 偏好: (用户偏好) -->
```

#### NOTES.md - 环境工具备注
记录特殊配置和工具使用说明。

**模板：**
```markdown
# Notes

<!-- 环境工具备注：记录当前环境的特殊配置 -->
<!-- 如 TTS 语音偏好、SSH 主机别名、常用路径等 -->
```

#### HEARTBEAT.md - 心跳任务清单
定期需要检查和执行的任务。

**模板：**
```markdown
# Heartbeat Tasks

<!-- 心跳任务清单：你定期需要检查和执行的事项 -->
<!-- 收到心跳轮询时，逐条检查并执行。文件为空则跳过。 -->
<!-- 格式：每行一个任务，用 - 开头 -->
```

#### AGENTS.md - Agent 级规则和技能配置
覆盖或补充全局规则，配置专属技能。

**模板：**
```markdown
# Agent Rules

<!-- Agent 级规则：覆盖/补充全局规则 -->
<!-- 积累经验教训时在此添加规则 -->


<skills_system priority="1">
## Available Skills

<usage>
以下技能已为智能体配置并自动激活。使用技能时：
1. 根据 path 读取对应的 SKILL.md 获取完整指令
2. 按照 SKILL.md 中的说明执行操作
</usage>

<available_skills>
<!-- 技能配置示例： -->
<!--
<skill>
<name>skill-name</name>
<description>技能描述</description>
<path>../../../skills/skill-name/SKILL.md</path>
</skill>
-->
</available_skills>

</skills_system>
```

### 4. skills/ 目录（可选）

存放智能体专属技能的目录。

**目录结构：**
```
skills/
├── my-custom-skill/
│   └── SKILL.md
└── another-skill/
    └── SKILL.md
```

**要求：**
- 每个技能一个独立目录
- 目录名使用 kebab-case（小写字母+连字符）
- 每个技能目录必须包含 `SKILL.md` 文件
- 可以包含其他资源文件（如示例代码、配置文件）

## 🛠️ 制作导入包的步骤

### 方法 1：手动制作（推荐）

当需要帮助用户创建智能体导入包时，按以下步骤执行：

**步骤 1：创建工作目录**
```bash
mkdir agent-package
cd agent-package
```

**步骤 2：创建 manifest.json**
```bash
cat > manifest.json << 'EOF'
{
  "formatVersion": "1.0",
  "exportedAt": "2026-04-15T10:30:00.000Z",
  "exportedBy": "coobee-agent",
  "appVersion": "1.0.0"
}
EOF
```

**步骤 3：创建 agent.json**
```bash
cat > agent.json << 'EOF'
{
  "id": "agent-example",
  "name": "示例智能体",
  "description": "这是一个示例智能体",
  "instructions": "你是一个友好的助手。",
  "createdBy": "user"
}
EOF
```

**步骤 4：创建人格文件（根据需要）**
```bash
# 创建 SOUL.md
cat > SOUL.md << 'EOF'
# Soul

你是一个专业、友好的智能助手。
EOF

# 创建其他人格文件...
```

**步骤 5：添加技能文件（可选）**
```bash
mkdir -p skills/example-skill
cat > skills/example-skill/SKILL.md << 'EOF'
# Example Skill

这是一个示例技能。
EOF
```

**步骤 6：打包成 ZIP**
```bash
# 在工作目录下打包所有文件
zip -r agent-example.zip ./*

# 或使用系统 zip 工具
tar -czf agent-example.zip *
```

### 方法 2：使用代码生成（高级）

如果用户提供了详细的智能体信息，你可以使用代码生成：

```javascript
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

// 1. 准备数据
const agentData = {
  id: 'agent-code-helper',
  name: '代码助手',
  description: '专业的编程辅助工具',
  instructions: '你是一个专业的代码助手...',
  // ... 其他配置
};

// 2. 创建临时目录
const tempDir = './temp-agent-package';
fs.mkdirSync(tempDir, { recursive: true });

// 3. 写入 manifest.json
const manifest = {
  formatVersion: '1.0',
  exportedAt: new Date().toISOString(),
  exportedBy: 'coobee-agent',
  appVersion: '1.0.0'
};
fs.writeFileSync(
  path.join(tempDir, 'manifest.json'),
  JSON.stringify(manifest, null, 2)
);

// 4. 写入 agent.json
fs.writeFileSync(
  path.join(tempDir, 'agent.json'),
  JSON.stringify(agentData, null, 2)
);

// 5. 写入人格文件（如果有）
if (agentData.personality) {
  fs.writeFileSync(
    path.join(tempDir, 'SOUL.md'),
    agentData.personality.soul || ''
  );
  // ... 其他人格文件
}

// 6. 打包成 ZIP
const zip = new AdmZip();
const files = fs.readdirSync(tempDir);
files.forEach(file => {
  const fullPath = path.join(tempDir, file);
  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    zip.addLocalFolder(fullPath, file);
  } else {
    zip.addLocalFile(fullPath);
  }
});
zip.writeZip(`${agentData.id}.zip`);

// 7. 清理临时目录
fs.rmSync(tempDir, { recursive: true });

console.log(`✅ 导入包已创建: ${agentData.id}.zip`);
```

## ✅ 验证清单

创建导入包后，使用以下清单验证：

### 必需项检查

- [ ] ZIP 文件可以正常解压
- [ ] 包含 `manifest.json` 文件
- [ ] `manifest.json` 格式正确，包含所有必需字段
- [ ] `manifest.json` 的 `formatVersion` 为 `"1.0"`
- [ ] 包含 `agent.json` 文件
- [ ] `agent.json` 格式正确，包含 `id`, `name`, `description` 字段
- [ ] `agent.json` 的 `id` 符合命名规范（`agent-*`）

### 可选项检查

- [ ] 人格文件使用 UTF-8 编码
- [ ] 人格文件使用 Markdown 格式
- [ ] `skills/` 目录结构正确
- [ ] 每个技能目录包含 `SKILL.md`

### 兼容性检查

- [ ] 文件名不包含非法字符（`< > : " / \ | ? *`）
- [ ] 所有文本文件使用 UTF-8 编码
- [ ] 所有文本文件使用 LF 或 CRLF 换行符
- [ ] ZIP 文件大小合理（建议 < 10MB）

## 🚫 常见错误和解决方案

### 错误 1：缺少必需文件

**错误信息：**
```
无效的 ZIP 包：缺少 manifest.json
```

**解决方案：**
确保 ZIP 包根目录包含 `manifest.json` 文件。

### 错误 2：格式版本不支持

**错误信息：**
```
不支持的格式版本: 2.0，当前支持版本: 1.0
```

**解决方案：**
检查 `manifest.json` 的 `formatVersion` 字段，确保为 `"1.0"`。

### 错误 3：agent.json 缺少必填字段

**错误信息：**
```
agent.json 缺少必填字段: name 或 description
```

**解决方案：**
确保 `agent.json` 包含 `id`, `name`, `description` 三个必填字段。

### 错误 4：ID 格式不正确

**错误信息：**
```
Invalid agent ID format: 应使用 agent-{slug} 格式
```

**解决方案：**
修改 `agent.json` 的 `id` 字段，使用正确的格式，例如：`agent-my-assistant`。

### 错误 5：编码问题

**症状：**
人格文件显示乱码。

**解决方案：**
确保所有文本文件使用 UTF-8 编码保存。

## 📚 示例导入包

### 示例 1：最小导入包

最简单的智能体导入包，只包含必需文件：

**文件结构：**
```
minimal-agent.zip
├── manifest.json
└── agent.json
```

**manifest.json：**
```json
{
  "formatVersion": "1.0",
  "exportedAt": "2026-04-15T12:00:00.000Z",
  "exportedBy": "coobee-agent",
  "appVersion": "1.0.0"
}
```

**agent.json：**
```json
{
  "id": "agent-minimal",
  "name": "最小智能体",
  "description": "一个最简单的智能体示例",
  "instructions": "你是一个友好的助手。",
  "createdBy": "user"
}
```

### 示例 2：完整导入包

包含所有人格文件和技能的完整示例：

**文件结构：**
```
complete-agent.zip
├── manifest.json
├── agent.json
├── IDENTITY.md
├── SOUL.md
├── USER.md
├── NOTES.md
├── HEARTBEAT.md
├── AGENTS.md
└── skills/
    └── custom-tool/
        └── SKILL.md
```

**agent.json：**
```json
{
  "id": "agent-complete",
  "name": "完整智能体",
  "description": "包含完整配置的智能体示例",
  "instructions": "你是一个专业的助手。",
  "model": "@group:default",
  "skills": ["custom-tool"],
  "createdBy": "user",
  "metadata": {
    "author": "示例作者",
    "tags": ["example", "complete"],
    "avatar": "🤖"
  }
}
```

**SOUL.md：**
```markdown
# Soul

## 核心原则

你是一个专业、高效、友好的智能助手。

## 行为准则

1. 准确理解用户需求
2. 提供清晰的解决方案
3. 保持专业和友好的态度
```

## 🔗 参考资源

- **设计文档**: `docs/01-designs/04-agent-import-export-format.md`
- **实现代码**: `src/main/agent/agents/AgentImportExport.ts`
- **导入 API**: `POST /gateway/agents/import`
- **导出 API**: `GET /gateway/agents/:id/export`

---

## 💡 使用建议

1. **始终从模板开始**：使用本规范提供的模板创建文件
2. **验证 JSON 格式**：使用 JSON 验证工具确保格式正确
3. **测试导入**：在本地环境测试导入包是否正常工作
4. **保持简洁**：只包含必要的文件和配置
5. **文档齐全**：如果包含自定义技能，确保 SKILL.md 详细清晰

---

**最后更新**: 2026-04-15  
**维护者**: Coobee Agent Team
