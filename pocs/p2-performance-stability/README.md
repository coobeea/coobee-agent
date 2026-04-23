# P2 - 性能与稳定性优化 POC

> 创建时间：2026-04-22
> 最后更新：2026-04-23
> 当前状态：核心改造与后续增强项已完成

## 概述

本 POC 解决 Agent 模块中 3 个 P2 级别问题：

- ✅ P2-1：事件写盘同步 IO 高频阻塞风险
- ✅ P2-2：CoreSkills 旧机制残留
- ✅ P2-3：Skill 缓存与 Extension 热重载缺少联动

## 本轮产出

### P2-1：事件写盘异步化

- 新增 `AsyncJsonlWriter`
- `EventWriter` 改为异步队列写入 `events.jsonl`
- `HistoryWriter` 改为异步队列写入 `history.jsonl`
- 会话结束和应用退出前强制 flush
- 支持队列上限、批量 flush、同步降级
- 支持可选 Worker 写盘路径：`COOBEE_AGENT_STREAM_WRITE_WORKER=1`
- 新增 100 events/s 基准流量自动化烟测

### P2-1 扩展：Store 批量读取异步化

- `ThreadStore.listAsync()` 使用异步目录扫描和并发读取 JSON
- `AgentStore.rebuildIndexAsync()` 使用异步目录扫描和并发读取 JSON
- `AgentStore.listAsync()` 提供明确异步列表入口
- Chat / Thread 路由、RPC、启动恢复扫描迁移到异步列表入口

### P2-2：CoreSkills 清理

- 删除 `src/main/agent/skills/CoreSkills.ts`
- 兼容实现迁入 `src/main/agent/skills/legacy/CoreSkills.ts`
- 删除旧 CoreSkills 测试
- 更新 Skill 架构文档，明确新代码不要依赖 CoreSkills

### P2-3：Skill 缓存失效

- `SkillManager.invalidateCache(path?, options?)` 支持防抖、立即失效和路径记录
- `SkillManager.getCacheStats()` 提供缓存命中统计
- Extension load / unload / watch 后主动失效 Skill 缓存
- 补充 SkillManager 和 ExtensionLoader 测试

## 验证结果

### 已通过

- P2 相关文件定向 `eslint`
- `pnpm run typecheck:node`
- P2 定向测试：`10 passed`，`108 passed`
- 全量 `pnpm test`：`68 passed | 6 skipped`，`888 passed | 54 skipped`

### 未执行

- 手动 Chat / Thread / Skill 热重载测试
- 桌面端真实 Agent 高频输出人工压测

## 文档结构

| 文件             | 说明                         |
| ---------------- | ---------------------------- |
| `01-需求分析.md` | 问题背景、目标定义、风险评估 |
| `02-方案设计.md` | 技术方案、实施顺序、回滚计划 |
| `03-反思优化.md` | 边界条件、安全性、性能分析   |
| `04-TODO.md`     | 当前任务状态和完成度         |
| `05-PROGRESS.md` | 实施时间轴和验证结果         |
| `06-BUGS.md`     | 问题记录和后续风险           |

## 相关文档

- [Agent Module Review](../../docs/architecture/agent-module-review.md)
- [Agent Execution Flow](../../docs/architecture/agent-execution-flow.md)
- [Core Skills Injection](../../docs/architecture/core-skills-injection.md)
