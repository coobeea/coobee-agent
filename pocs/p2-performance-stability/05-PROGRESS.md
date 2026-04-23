# P2 - 性能与稳定性优化：进度跟踪

> 创建时间：2026-04-22
> 最后更新：2026-04-23
> 当前状态：P2 核心改造与后续增强项已完成，剩余为桌面端人工验证

## 总体进度

| 阶段     | 状态   | 说明                                                                                             |
| -------- | ------ | ------------------------------------------------------------------------------------------------ |
| 需求分析 | 已完成 | 2026-04-22 完成                                                                                  |
| 方案设计 | 已完成 | 2026-04-22 完成                                                                                  |
| 反思优化 | 已完成 | 2026-04-22 完成                                                                                  |
| 实施开发 | 已完成 | CoreSkills legacy、Skill cache invalidation、Async JSONL writer、Store async、Worker path 已落地 |
| 测试验证 | 已完成 | 自动化验证通过，桌面端人工 Chat / Thread / Skill 热重载测试未执行                                |
| 文档更新 | 已完成 | 架构文档和 POC 已同步                                                                            |

## 关键产出

### 代码改造

- 新增 `src/main/agent/streaming/consumers/AsyncJsonlWriter.ts`
- 更新 `src/main/agent/streaming/consumers/EventWriter.ts`
- 更新 `src/main/agent/streaming/consumers/HistoryWriter.ts`
- 更新 `src/main/agent/streaming/StreamConsumersManager.ts`
- 更新 `src/main/agent/AgentExecutor.ts`
- 更新 `src/main/lifecycle/ReadyAgentSystemHook.ts`
- 更新 `src/main/agent/skills/SkillManager.ts`
- 更新 `src/main/agent/extension/ExtensionLoader.ts`
- 更新 `src/main/agent/threads/ThreadStore.ts`
- 更新 `src/main/agent/agents/AgentStore.ts`
- 更新 `src/main/routes/AgentRoutes.ts`
- 更新 `src/main/routes/ChatRoutes.ts`
- 更新 `src/main/routes/ThreadRoutes.ts`
- 更新 `src/main/rpc/ChatMethods.ts`
- 更新 `src/main/agent/threads/ThreadWaker.ts`
- 新增 `src/main/agent/skills/legacy/CoreSkills.ts`
- 删除 `src/main/agent/skills/CoreSkills.ts`
- 删除 `src/main/agent/skills/__tests__/CoreSkills.test.ts`
- 删除 `src/main/agent/agents/__tests__/AgentStore.defaultSkills.test.ts`

### 测试改造

- 新增 `src/main/agent/streaming/__tests__/AsyncJsonlWriter.test.ts`
- 新增 `src/main/agent/streaming/__tests__/StreamConsumersWriters.test.ts`
- 新增 `src/main/agent/extension/__tests__/ExtensionLoader.skill-cache.test.ts`
- 新增 `src/main/agent/agents/__tests__/AgentStore.async-list.test.ts`
- 更新 `src/main/agent/skills/__tests__/SkillManager.test.ts`
- 更新 `src/main/agent/threads/__tests__/ThreadStore.enhanced.test.ts`

### 文档改造

- 更新 `docs/architecture/README.md`
- 重写 `docs/architecture/core-skills-injection.md`
- 更新 `docs/architecture/skills-injection-change.md`
- 更新 `docs/architecture/agent-execution-flow.md`
- 更新 `docs/architecture/agent-module-review.md`
- 更新 `src/main/agent/README.md`

## 时间轴

### 2026-04-22

- ✅ 创建 P2 POC 目录
- ✅ 完成需求分析、方案设计、反思优化
- ✅ 拆分 17 个任务

### 2026-04-23

#### 阶段 1：CoreSkills 清理

- ✅ 扫描 CoreSkills 依赖
- ✅ 将兼容实现迁入 `skills/legacy/CoreSkills.ts`
- ✅ 删除主路径 `skills/CoreSkills.ts`
- ✅ 删除旧 CoreSkills 测试
- ✅ 更新 Skill 机制文档

#### 阶段 2：Skill 缓存失效

- ✅ `SkillManager.invalidateCache()` 支持 path、immediate、300ms 防抖
- ✅ 新增 `SkillManager.getCacheStats()`
- ✅ 新增 `SkillManager.resetCacheForTests()`
- ✅ Extension load / loadAll / unload 后主动失效缓存
- ✅ watch 路径复用 load/unload 失效逻辑
- ✅ 补充 ExtensionLoader 与 SkillManager 测试

#### 阶段 3：事件写盘异步化

- ✅ 新增 `AsyncJsonlWriter`
- ✅ EventWriter 改为异步队列写入 `events.jsonl`
- ✅ HistoryWriter 改为异步队列写入 `history.jsonl`
- ✅ StreamConsumersManager 在 destroy / clearSession 时等待 flush
- ✅ AgentExecutor finally 中 await clearSession
- ✅ BeforeQuitAgentSystemHook await destroy
- ✅ 实现队列上限、flush、closeFile、closeAll、同步降级
- ✅ 补充异步写盘测试
- ✅ 支持 `COOBEE_AGENT_STREAM_WRITE_WORKER=1` 开启 Worker 写盘
- ✅ Worker 写盘失败时回退到普通异步 append
- ✅ 新增 100 events/s 基准流量自动化烟测

#### 阶段 3.5：Store 批量读取异步化

- ✅ `ThreadStore.listAsync()` 使用异步目录扫描和并发读取 JSON
- ✅ `ThreadStore.list()` 保留兼容入口并委托到异步实现
- ✅ ChatRoutes / ThreadRoutes / ChatMethods / ThreadWaker 迁移到 `listAsync()`
- ✅ `AgentStore.rebuildIndexAsync()` 使用异步目录扫描和并发读取 JSON
- ✅ `AgentStore.listAsync()` 提供明确异步列表入口
- ✅ 内置 Agent seed 的批量读取改为异步
- ✅ 补充 AgentStore / ThreadStore 异步列表测试

#### 阶段 4：验证与文档

- ✅ P2 相关文件定向 eslint 通过
- ✅ `pnpm run typecheck:node` 通过
- ✅ P2 定向测试通过：`10 passed`，`108 passed`
- ✅ 全量 `pnpm test` 通过：`68 passed | 6 skipped`，`888 passed | 54 skipped`
- ✅ 架构文档同步完成

## 验证结果

### 已通过

- P2 相关文件定向 `eslint`
- `pnpm run typecheck:node`
- P2 定向测试：
  - `AsyncJsonlWriter.test.ts`
  - `StreamConsumersWriters.test.ts`
  - `SkillManager.test.ts`
  - `ExtensionLoader.skill-cache.test.ts`
  - streaming 现有测试
- P2 后续增强定向测试：
  - `AsyncJsonlWriter.test.ts`
  - `ThreadStore.enhanced.test.ts`
  - `AgentStore.async-list.test.ts`
- `pnpm test`

### 未执行 / 后续项

- 未执行手动 Chat / Thread / Skill 热重载测试
- 未执行桌面端真实 Agent 高频输出人工压测

## 当前判断

- P2 核心目标已经完成：事件高频写盘路径异步化、CoreSkills 旧主路径清理、Skill 缓存热重载联动。
- 后续增强项也已完成：Store 批量读取异步化、可选 Worker 写盘路径、100 events/s 自动基准烟测。
- 本轮没有引入 Node 侧类型错误或测试回归。
- 后续如果要继续推进性能，可以补真实桌面端高频输出人工压测和更细的性能指标采样。
