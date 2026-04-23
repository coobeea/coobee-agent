# 架构文档

本目录包含 Coobee Agent 系统的架构设计文档。

## 文档列表

### 核心机制

1. **[Skills 注入机制重大变更](./skills-injection-change.md)** ⭐ **最新**
   - 移除强制注入，改为配置文件控制
   - 旧机制 vs 新机制对比
   - 迁移指南和影响分析
   - UI/文档改进建议

2. **[AppendInstructions 内容说明](./append-instructions-content.md)**
   - Runtime Environment 完整内容
   - Skill Discovery 提示
   - 生成机制和代码位置
   - 动态内容说明
   - System Prompt 结构

3. **[`src/main/agent` 模块梳理与优化建议](./agent-module-review.md)** ⭐
   - 执行链路、模块边界、真实职责图
   - 当前不合理点与优化优先级
   - 推荐的收敛和重构顺序
   - P2 性能与稳定性收敛：异步 JSONL 写盘、Store 批量读取异步化、可选 Worker 写盘

4. **[核心 Skills 自动注入机制](./core-skills-injection.md)** ⚠️ **历史归档**
   - 旧核心 Skills 强制注入机制说明
   - 当前状态：主路径已移除，仅保留 `legacy/CoreSkills.ts` 兼容层
   - **注意**: 新代码不要依赖 `CORE_SKILLS` / `ensureCoreSkills()`

### Workspace 目录结构

5. **[目录简化实施总结](../../DIRECTORY_SIMPLIFICATION.md)** _(根目录)_
   - 旧结构 vs 新结构对比
   - 修改的文件列表
   - 测试验证方法

6. **[Workspace 修复总结](../../WORKSPACE_FIX_SUMMARY.md)** _(根目录)_
   - 问题诊断和修复过程
   - PiMono Session 文件说明
   - Runtime 对比

### Context Snapshot

7. **Context Snapshot 相关**
   - [Context Snapshot Agent 信息问题](../issues/context-snapshot-agent-info-issues.md) _(Issues 目录)_
     - Instructions 默认值问题
     - Name/Description 未记录问题
     - 核心 Skills 自动注入未说明

## 架构概览

### Agent 执行流程

```
用户请求
    ↓
AgentExecutor.execute()
    ↓
injectEnv() ← 注入运行时环境
    ↓
  ├─ 扫描 Skills (SkillManager)
  ├─ 根据 Agent 配置注入 Skills
  ├─ 生成 appendInstructions
  │   ├─ runtime_environment
  │   ├─ skill_discovery
  │   └─ 其他注入内容
  ├─ 注入工具 (ToolRegistry)
  └─ 设置沙箱环境
    ↓
Builder.build() → Runtime
    ↓
Runtime.runStream()
    ↓
LLM API 调用（包含完整 System Prompt）
    ↓
Stream 输出
    ↓
保存 Context Snapshot
```

### 文件系统结构

```
.home/
  ├── agents/                    # Agent 定义
  │   └── {agentId}.json
  ├── workspaces/                # 运行时工作空间
  │   └── {sessionId}/
  │       ├── sessions/          # SDK 会话文件
  │       ├── history.jsonl      # 前端展示
  │       ├── events.jsonl       # 调试事件
  │       └── context.jsonl      # 上下文快照
  ├── threads/                   # Thread 定义
  │   └── {threadId}.json
  ├── config/                    # 配置文件
  ├── skills/                    # 用户 Skills
  └── data/                      # Agent 数据目录
      └── {agentId}/
```

### 关键概念

#### Agent vs Thread vs Session

- **Agent**: 智能体定义，包含名称、描述、模型、Skills 等配置
- **Thread**: 对话线程，关联一个 Agent，包含多轮对话
- **Session**: 运行时会话，对应一个 workspace，包含执行状态

通常关系：`Thread.id === Session.id`（主 Agent）

#### Skills 层次

⚠️ **注意**: 自 2026-04-22 起，不再强制注入核心 Skills。

1. **Agent 配置 Skills** (Agent 配置文件指定)
   - 在 Agent 定义的 `skills` 数组中指定
   - 完全由用户控制
   - 空数组 = 不加载任何 Skill

2. **Extension Skills** (Extension 系统贡献)
   - 由已加载的 Extension 提供
   - Extension 加载、卸载和热重载后会主动失效 Skill 缓存

3. **推荐的基础 Skills** (供参考，不再强制注入)
   - execution-protocol - 任务分解、五步工作法
   - self-reflection - 自我评估与修复
   - eval-refine-loop - 输出质量评估
   - brain - 知识库搜索与复用
   - dimension-architect - 需求维度量化

#### Instructions 构成

```
最终 System Prompt =
  基础 instructions (用户配置)
  + appendInstructions (系统注入)
    ├─ runtime_environment
    ├─ skill_discovery
    ├─ agents_md (AGENTS.md)
    ├─ agent_home (SOUL.md, USER.md 等)
    ├─ workspace_context
    └─ extension_instructions
```

#### P2 IO 稳定性

- `EventWriter` / `HistoryWriter` 通过 `AsyncJsonlWriter` 异步批量写入 JSONL。
- `COOBEE_AGENT_STREAM_WRITE_WORKER=1` 可启用可选 Worker 写盘路径，默认仍走普通异步 append。
- `ThreadStore.listAsync()` / `AgentStore.listAsync()` 作为列表场景的明确异步入口，兼容 `list()` 仍可用。

## 相关目录

- **[Issues 问题追踪](../issues/)** - 已知问题和 Bug
- **[API 文档](../api/)** - API 接口文档 _(待创建)_
- **[开发指南](../development/)** - 开发者指南 _(待创建)_

## 贡献指南

添加新的架构文档时，请：

1. 在本目录创建 Markdown 文件
2. 使用清晰的标题和结构
3. 包含代码示例和流程图
4. 更新本 README 的文档列表

---

**最后更新**: 2026-04-23
**维护者**: Coobee Team
