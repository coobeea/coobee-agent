# Issues 问题追踪

本目录记录了项目中发现的问题和待修复的 Bug。

## 问题列表

### 🔴 待修复

1. **[Context Snapshot Agent 信息问题](./context-snapshot-agent-info-issues.md)** - 2026-04-22
   - 优先级: 中等（问题1、2）/ 低（问题3）
   - 类型: 数据完整性 / UX 改进
   - 影响: Context Snapshot 调试和分析 / 用户理解
   - 问题:
     - **问题1**: Agent 配置的空 instructions 被默认值覆盖
     - **问题2**: Agent 的 name 和 description 未正确记录到 context.jsonl
     - **问题3**: 核心 Skills 自动注入未在 Agent 配置中说明

2. **[Agent Runtime 选择被硬编码为 PiMono 的问题](./hardcoded-runtime-selection.md)** - 2026-04-23
   - 优先级: 高
   - 类型: 架构设计 / 可扩展性
   - 影响: Chat 主链路 / Thread 恢复 / IPC / Extension 执行入口
   - 问题:
     - **问题1**: 多个入口直接写死 `agentExecutor.piMono()`
     - **问题2**: runtime 选择没有进入 Agent / Thread 领域模型
     - **问题3**: runtime 选择和 `sessionMode` / `lightweight` 等执行语义耦合在调用方

3. **[Extension Hook 生命周期时机过粗且语义不一致](./extension-hook-lifecycle-gaps.md)** - 2026-04-23
   - 优先级: 高
   - 类型: 架构设计 / 扩展系统契约
   - 影响: Extension 生命周期理解 / 清理收尾 / lightweight 路径一致性
   - 问题:
     - **问题1**: `AgentExecutor` 主链路仍主要暴露 start/end 两段集中时机
     - **问题2**: `session_start` / `session_end` 的名字和真实执行语义不一致
     - **问题3**: end hooks 不覆盖失败路径，且部分公开 Hook 已声明但未接线

4. **[Thread / Session / History / Events 持久化边界漂移](./persistence-boundary-drift.md)** - 2026-04-23
   - 优先级: 高
   - 类型: 架构设计 / 持久化边界
   - 影响: Thread 创建链路 / 历史展示 / 事件落盘 / 目录迁移
   - 问题:
     - **问题1**: `ThreadStore` 已越过 Thread 元数据边界，承担 Agent/Workspace 副作用
     - **问题2**: `history.jsonl` 不是纯投影，依赖入口手工补用户消息
     - **问题3**: 事件层新旧两套抽象并存，session/history/events 语义开始混用

### ✅ 已修复

暂无

---

## 问题状态说明

- 🔴 **待修复**: 已确认的问题，等待修复
- 🟡 **进行中**: 正在修复中
- ✅ **已修复**: 已完成修复并验证
- ⏸️ **暂缓**: 暂不处理的问题

## 提交问题

发现新问题时，请：
1. 在本目录创建新的 Markdown 文件
2. 使用模板格式记录问题详情
3. 更新本 README 的问题列表

## 问题模板

```markdown
# [问题标题]

## 发现日期
YYYY-MM-DD

## 问题概述
简要描述问题

## 问题详情
详细说明

## 影响范围
- 受影响的功能
- 不受影响的功能

## 优先级
低/中/高/紧急

## 建议修复方案
具体的修复步骤

## 相关文件
- file1.ts
- file2.ts

## 测试建议
修复后应如何验证
```
