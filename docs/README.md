# Coobee Agent 文档索引

本目录包含 Coobee Agent 项目的所有设计文档、架构说明和开发指南。

## 📂 目录结构规范

所有目录和文件都使用序号命名，便于管理和查找。

```
docs/
├── README.md                 # 本文件（文档索引）
├── 01-designs/               # 设计文档（架构方案、技术选型）
├── 02-guides/                # 开发指南（如何使用、最佳实践）
├── 03-rfcs/                  # RFC 文档（重大变更提案）
└── 04-references/            # 参考文档（API 文档、配置说明）
```

### 01-designs/ - 设计文档

设计方案和架构文档，按时间顺序编号（最新的编号最大）。

**命名规范**：`{序号}-{文档名称}.md`

**当前文档**：

- **01-websocket-push-architecture.md** - WebSocket 业务事件推送架构设计（v1.0 详细版）
  - 创建时间：2026-04-11
  - 状态：⚠️ 已被简化版替代
  - 内容：详细的三层架构设计，包含完整的代码实现

- **02-websocket-push-simplified.md** - WebSocket 业务事件推送架构设计（v2.0 简化版）
  - 创建时间：2026-04-11
  - 状态：⚠️ 已被自动扫描版替代
  - 内容：简化版设计，对标 IpcEventBroadcaster 的单一类实现

- **03-gateway-auto-scan-design.md** - Gateway 自动扫描架构设计（v3.0 最终版）
  - 创建时间：2026-04-11
  - 状态：✅ **当前推荐方案**
  - 内容：自动扫描机制，业务层通过文件约定自动注册，通用层无需修改

### 02-guides/ - 开发指南

（待添加）

### 03-rfcs/ - RFC 文档

（待添加）

### 04-references/ - 参考文档

（待添加）

---

## 📝 文档创建规范

### 1. 目录分类

根据文档类型放入对应**序号目录**：

```
docs/
├── README.md                 # 本文件（文档索引）
├── 01-designs/               # 设计文档（架构方案、技术选型）
├── 02-guides/                # 开发指南（如何使用、最佳实践）
├── 03-rfcs/                  # RFC 文档（重大变更提案）
└── 04-references/            # 参考文档（API 文档、配置说明）
```

**目录序号说明**：
- 目录序号固定，不随时间变化
- `01-designs/` - 最重要的设计文档放在第一位
- 目录内的文档使用独立的序号体系（从 01 开始）

### 2. 文件命名规范

**格式**：`{序号}-{简短描述}.md`

**序号规则**：
- 两位数字，从 01 开始
- 按创建时间递增
- 同一目录内序号唯一

**示例**：
```
01-designs/
├── 01-websocket-push-architecture.md
├── 02-websocket-push-simplified.md
├── 03-gateway-auto-scan-design.md
└── 04-[下一个设计方案].md

02-guides/
├── 01-getting-started.md
├── 02-development-workflow.md
└── 03-[下一个指南].md
```

### 3. 文档头部规范

每个文档都应包含以下元信息：

```markdown
# [文档标题]

> 日期：YYYY-MM-DD  
> 版本：vX.X  
> 状态：[设计方案 | 已实施 | 已废弃]

## 概述

[简要说明文档目的和背景]
```

### 4. 状态标记

使用 emoji 标记文档状态：

- 📝 **设计中** - 正在编写的设计方案
- ✅ **已实施** - 已经实现并在使用
- 🔄 **进行中** - 正在实施
- ⚠️ **已废弃** - 已被新方案替代
- 📚 **参考** - 作为历史参考保留

### 5. 文档更新

- 当创建新版本设计时，在旧文档顶部添加提示：
  ```markdown
  > ⚠️ **注意**：本方案已被 [新方案名称](链接) 替代，保留作为历史参考。
  ```

- 在 README.md 中更新文档列表
- 保持序号不变，新文档使用新序号

---

## 🔍 快速查找

### 按主题查找

**WebSocket / Gateway 相关**：
- [03-gateway-auto-scan-design.md](01-designs/03-gateway-auto-scan-design.md) - ✅ 最新推荐

**配置管理相关**：
- （待添加）

**多进程架构相关**：
- （待添加）

### 按状态查找

**✅ 当前使用中**：
- [03-gateway-auto-scan-design.md](01-designs/03-gateway-auto-scan-design.md)

**⚠️ 已废弃（保留参考）**：
- [01-websocket-push-architecture.md](01-designs/01-websocket-push-architecture.md)
- [02-websocket-push-simplified.md](01-designs/02-websocket-push-simplified.md)

---

## 📊 文档统计

- **总文档数**：3
- **设计文档**：3
- **当前有效**：1
- **历史参考**：2

---

## 🤝 贡献指南

创建新文档时，请遵循以下流程：

1. **确定文档类型**，选择对应序号目录（01-designs/ / 02-guides/ / 03-rfcs/ / 04-references/）
2. **查看该目录下当前最大序号**，新文档使用 `最大序号 + 1`
3. **使用规范的文件名**：`{序号}-{描述}.md`
4. **添加文档头部**（日期、版本、状态）
5. **更新 README.md**，在对应章节添加文档链接
6. **提交时说明**：`docs: add {目录序号}-{目录名称}/{文件序号}-{描述}`

**示例**：
```bash
# 在 01-designs/ 下创建第 4 个设计文档
touch docs/01-designs/04-config-management-design.md

# 提交
git commit -m "docs: add 01-designs/04-config-management-design"
```

---

最后更新：2026-04-11
