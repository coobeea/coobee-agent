# Coobee Agent 文档中心

## 📚 目录

1. [📚 文档导航](#文档导航)
   1.1 [🏗️ [架构文档](./architecture/)](#架构文档architecture)
   1.2 [🐛 [问题追踪](./issues/)](#问题追踪issues)
   1.3 [📖 API 文档 *(待创建)*](#api-文档-待创建)
   1.4 [🛠️ 开发指南 *(待创建)*](#开发指南-待创建)
2. [🚀 快速开始](#快速开始)
   2.1 [理解 Agent 执行流程](#理解-agent-执行流程)
   2.2 [调试和问题排查](#调试和问题排查)
   2.3 [贡献文档](#贡献文档)
3. [📂 文档结构](#文档结构)
4. [🔍 常见问题速查](#常见问题速查)
   4.1 [Q1: 为什么 Agent 配置的 instructions 是空的，但运行时显示 "你是一个 AI 助手"？](#q1-为什么-agent-配置的-instructions-是空的但运行时显示-你是一个-ai-助手)
   4.2 [Q2: 为什么 Agent 配置的 skills 是空数组，但实际运行时有 5 个 Skills？](#q2-为什么-agent-配置的-skills-是空数组但实际运行时有-5-个-skills)
   4.3 [Q3: appendInstructions 里面都有什么内容？](#q3-appendinstructions-里面都有什么内容)
   4.4 [Q4: context.jsonl 文件是什么？有什么用？](#q4-contextjsonl-文件是什么有什么用)
   4.5 [Q5: workspace 目录结构是怎样的？](#q5-workspace-目录结构是怎样的)
   4.6 [Q6: 明明系统里已经有两个 runtime，为什么主链路看起来还是固定跑 PiMono？](#q6-明明系统里已经有两个-runtime为什么主链路看起来还是固定跑-pimono)
   4.7 [Q7: Extension Hook 现在是不是基本只有 start / end 两个时机？](#q7-extension-hook-现在是不是基本只有-start-end-两个时机)
   4.8 [Q8: 为什么说 Thread / session / history / events 这几层的边界已经有点漂移了？](#q8-为什么说-thread-session-history-events-这几层的边界已经有点漂移了)
5. [🔗 相关资源](#相关资源)
6. [📝 文档约定](#文档约定)
   6.1 [Markdown 格式](#markdown-格式)
   6.2 [代码示例](#代码示例)
   6.3 [流程图](#流程图)
7. [📮 反馈和建议](#反馈和建议)

---


欢迎来到 Coobee Agent 文档中心！这里包含了项目的架构设计、问题追踪、开发指南等文档。

## 📚 文档导航

### 🏗️ [架构文档](./05-architecture/)

系统架构设计和核心机制说明：

- **[`src/main/agent` 模块梳理与优化建议](./05-architecture/agent-module-review.md)**
  - `src/main/agent` 的真实职责边界和执行链路
  - 当前不合理点、遗留层、可优化方向
  - 推荐的收敛和重构顺序

- **[核心 Skills 自动注入机制](./05-architecture/core-skills-injection.md)**
  - 为什么 Agent 配置的 skills 是空数组，但运行时有 5 个 Skills？
  - 核心 Skills 注入流程和设计原理

- **[AppendInstructions 内容说明](./05-architecture/append-instructions-content.md)**
  - Runtime Environment 完整内容解析
  - System Prompt 的构成和生成机制
  - 动态注入的环境信息

- **Workspace 目录结构** *(根目录)*
  - [目录简化实施总结](../DIRECTORY_SIMPLIFICATION.md)
  - [Workspace 修复总结](../WORKSPACE_FIX_SUMMARY.md)

### 🐛 [问题追踪](./06-issues/)

已知问题和 Bug 记录：

- **[Agent Runtime 选择被硬编码为 PiMono 的问题](./06-issues/hardcoded-runtime-selection.md)**
  - `piMono()` 在多个主入口被直接写死
  - runtime 选择尚未进入 Agent / Thread 配置模型
  - `runtime` 与 `sessionMode` / `lightweight` 语义耦合

- **[Extension Hook 生命周期时机过粗且语义不一致](./06-issues/extension-hook-lifecycle-gaps.md)**
  - 主执行链路仍主要是 start/end 两段 Hook
  - `session_*` 的命名和真实触发语义存在偏差
  - 失败路径、lightweight 路径、已声明未接线 Hook 之间不一致

- **[Thread / Session / History / Events 持久化边界漂移](./06-issues/persistence-boundary-drift.md)**
  - `ThreadStore` 已开始承担 Agent/Workspace 副作用
  - `history.jsonl` 依赖入口手工补写用户消息
  - 事件层仍有新旧两套落盘链路共存

- **[Context Snapshot Agent 信息问题](./06-issues/context-snapshot-agent-info-issues.md)**
  - 问题 1: Instructions 默认值覆盖
  - 问题 2: Name/Description 未正确记录
  - 问题 3: 核心 Skills 自动注入未说明

### 📖 API 文档 *(待创建)*

### 🛠️ 开发指南 *(待创建)*

## 🚀 快速开始

### 理解 Agent 执行流程

1. 阅读 [`src/main/agent` 模块梳理与优化建议](./05-architecture/agent-module-review.md) 了解真实执行链路和当前结构问题
2. 阅读 [AppendInstructions 内容说明](./05-architecture/append-instructions-content.md) 了解 System Prompt 构成
3. 查看 [架构文档总览](./05-architecture/) 了解整体架构

### 调试和问题排查

1. 查看 [问题追踪](./06-issues/) 中是否有类似问题
2. 检查 `context.jsonl` 文件了解实际执行情况
3. 查看日志文件定位问题

### 贡献文档

1. 在相应目录创建 Markdown 文件
2. 使用清晰的标题和结构
3. 包含代码示例和流程图
4. 更新相应目录的 README

## 📂 文档结构

```
docs/
├── README.md                           # 本文件，文档中心首页
├── 01-designs/                         # 设计文档
├── 02-guides/                          # 开发指南
├── 03-rfcs/                            # RFC 文档
├── 04-references/                      # 参考文档
├── 05-architecture/                    # 架构文档
│   ├── README.md                          架构文档索引
│   ├── agent-module-review.md             src/main/agent 模块梳理与优化建议
│   ├── core-skills-injection.md           核心 Skills 注入机制
│   └── append-instructions-content.md     AppendInstructions 内容
└── 06-issues/                          # 问题追踪
    ├── README.md                          问题列表索引
    ├── extension-hook-lifecycle-gaps.md  Extension Hook 生命周期问题
    ├── hardcoded-runtime-selection.md     runtime 选择被硬编码问题
    ├── persistence-boundary-drift.md      持久化边界漂移问题
    └── context-snapshot-agent-info-issues.md
```

## 🔍 常见问题速查

### Q1: 为什么 Agent 配置的 instructions 是空的，但运行时显示 "你是一个 AI 助手"？

**A**: 这是默认值覆盖问题。查看 [Context Snapshot Agent 信息问题 - 问题1](./06-issues/context-snapshot-agent-info-issues.md#问题-1-instructions-默认值覆盖问题)

### Q2: 为什么 Agent 配置的 skills 是空数组，但实际运行时有 5 个 Skills？

**A**: 这是核心 Skills 自动注入机制。查看 [核心 Skills 自动注入机制](./05-architecture/core-skills-injection.md)

### Q3: appendInstructions 里面都有什么内容？

**A**: 包含 runtime_environment、skill_discovery 等。查看 [AppendInstructions 内容说明](./05-architecture/append-instructions-content.md)

### Q4: context.jsonl 文件是什么？有什么用？

**A**: Context Snapshot，记录每次 LLM 调用的完整上下文，用于调试和分析。查看 [AppendInstructions 内容说明 - Context Snapshot 中的记录](./05-architecture/append-instructions-content.md#context-snapshot-中的记录)

### Q5: workspace 目录结构是怎样的？

**A**: 扁平化结构，包含 sessions/、history.jsonl、events.jsonl、context.jsonl。查看 [目录简化实施总结](../DIRECTORY_SIMPLIFICATION.md)

### Q6: 明明系统里已经有两个 runtime，为什么主链路看起来还是固定跑 PiMono？

**A**: 因为当前多个入口直接写死了 `agentExecutor.piMono()`，runtime 选择还没有被抽到统一配置和统一组装层。查看 [Agent Runtime 选择被硬编码为 PiMono 的问题](./06-issues/hardcoded-runtime-selection.md)

### Q7: Extension Hook 现在是不是基本只有 start / end 两个时机？

**A**: 从 `AgentExecutor` 主执行链路看，确实主要是前后两段集中触发；虽然系统里还有 tool / turn / compaction / model 相关 Hook，但它们分散在不同模块里，而且还存在语义不一致和未接线的问题。查看 [Extension Hook 生命周期时机过粗且语义不一致](./06-issues/extension-hook-lifecycle-gaps.md)

### Q8: 为什么说 Thread / session / history / events 这几层的边界已经有点漂移了？

**A**: 因为 `ThreadStore` 已经不只是存 Thread 元数据，`history.jsonl` 也不再是纯事件投影，事件落盘还同时存在新旧两套链路。查看 [Thread / Session / History / Events 持久化边界漂移](./06-issues/persistence-boundary-drift.md)

## 🔗 相关资源

- **项目 README**: [../README.md](../README.md)
- **源代码**: `src/main/agent/`
- **测试文件**: `src/main/agent/__tests__/`

## 📝 文档约定

### Markdown 格式

- 使用清晰的标题层级（H1-H6）
- 代码块指定语言（```typescript, ```bash 等）
- 使用表格、列表增强可读性
- 重要信息使用引用块或警告标记

### 代码示例

- 提供完整的代码路径
- 标注关键代码行
- 包含必要的上下文
- 添加注释说明

### 流程图

使用文本流程图或 Mermaid 图表：

```
步骤1
  ↓
步骤2
  ↓
步骤3
```

## 📮 反馈和建议

发现文档问题或有改进建议？
- 在 Issues 中提出
- 直接提交 PR 改进文档
- 联系维护团队

---

**最后更新**: 2026-04-23  
**维护者**: Coobee Team  
**文档版本**: 1.0
