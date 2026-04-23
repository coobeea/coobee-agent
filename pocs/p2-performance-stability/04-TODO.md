# P2 - 性能与稳定性优化：任务清单

> 创建时间：2026-04-22
> 最后更新：2026-04-23

## 状态说明

- [ ] 待处理
- [x] 已完成
- [~] 主体完成，仍有后续增强项
- [-] 本轮不执行 / 后续单独处理

## 当前结论

- [x] P2-2 CoreSkills 主路径残留已清理。
- [x] P2-3 Skill 缓存已和 Extension 装卸/热重载建立联动。
- [x] P2-1 事件写盘第一层已异步化。
- [x] Store 批量读取异步化、可选 Worker 写盘路径、100 events/s 自动基准烟测已补齐。

---

## 阶段 1：P2-2 CoreSkills 清理

### 任务 1.1：代码依赖扫描

- **描述**：全局搜索 CoreSkills 相关引用。
- **验收标准**：
  - [x] 搜索 `import.*CoreSkills`
  - [x] 搜索 `CoreSkills.get` / `ensureCoreSkills` / `CORE_SKILLS`
  - [x] 记录依赖位置
  - [x] 评估影响范围
- **状态**：[x] 已完成

### 任务 1.2：移至 legacy/ 目录

- **描述**：将 CoreSkills 迁入 legacy，并标记废弃。
- **验收标准**：
  - [x] 创建 `src/main/agent/skills/legacy/`
  - [x] 移动兼容实现到 `src/main/agent/skills/legacy/CoreSkills.ts`
  - [x] 添加 `@deprecated` 注释
  - [x] 更新 `src/main/agent/skills/index.ts` 导出路径
- **状态**：[x] 已完成

### 任务 1.3：清理相关测试

- **描述**：删除或更新 CoreSkills 相关测试。
- **验收标准**：
  - [x] 删除 `src/main/agent/skills/__tests__/CoreSkills.test.ts`
  - [x] 删除 `src/main/agent/agents/__tests__/AgentStore.defaultSkills.test.ts`
  - [x] 全量 `pnpm test` 通过
- **状态**：[x] 已完成

### 任务 1.4：更新文档

- **描述**：更新架构文档，明确 Skill 机制。
- **验收标准**：
  - [x] 更新 `docs/architecture/README.md`
  - [x] 重写 `docs/architecture/core-skills-injection.md` 为历史归档
  - [x] 更新 `docs/architecture/skills-injection-change.md`
  - [x] 更新 `docs/architecture/agent-module-review.md`
- **状态**：[x] 已完成

---

## 阶段 2：P2-3 Skill 缓存失效

### 任务 2.1：增加缓存失效接口

- **描述**：在 SkillManager 中增加带防抖和统计的失效方法。
- **验收标准**：
  - [x] 实现 `invalidateCache(path?: string, options?: { immediate?: boolean })`
  - [x] 增加 300ms 防抖逻辑
  - [x] 支持记录失效 path
  - [x] 增加缓存统计 `getCacheStats()`
  - [x] 增加测试隔离方法 `resetCacheForTests()`
- **状态**：[x] 已完成

### 任务 2.2：Hook Extension 生命周期

- **描述**：在 ExtensionLoader 中调用缓存失效。
- **验收标准**：
  - [x] `loadAll()` 完成后调用 `invalidateCache()`
  - [x] `load()` 成功后调用 `invalidateCache(dir, { immediate: true })`
  - [x] `unload()` 时调用 `invalidateCache(extensionId, { immediate: true })`
  - [x] watch 触发的 unload/load 会复用上述失效路径
- **状态**：[x] 已完成

### 任务 2.3：集成测试

- **描述**：验证热重载相关缓存失效。
- **验收标准**：
  - [x] 编写 `ExtensionLoader.skill-cache.test.ts`
  - [x] 编写 SkillManager cache stats / invalidation 测试
  - [x] P2 定向测试通过
- **状态**：[x] 已完成

---

## 阶段 3：P2-1 事件写盘异步化

### 任务 3.1：实现异步队列

- **描述**：实现 `AsyncJsonlWriter`。
- **验收标准**：
  - [x] 创建 `AsyncJsonlWriter.ts`
  - [x] 实现内存队列
  - [x] 实现 `writeLine()` 入队
  - [x] 实现 `flush()` / `closeFile()` / `closeAll()`
  - [x] 实现队列上限处理
  - [x] 实现连续失败后同步降级
- **状态**：[x] 已完成

### 任务 3.2：实现 AsyncHistoryWriter

- **描述**：HistoryWriter 异步化。
- **验收标准**：
  - [x] `HistoryWriter` 复用 `AsyncJsonlWriter`
  - [x] 保持 `writeUserMessage()` 和 EventBus listener 接口兼容
  - [x] 增加 writer 测试
- **状态**：[x] 已完成

### 任务 3.3：集成到 StreamConsumersManager

- **描述**：切换消费者管理器到异步 flush。
- **验收标准**：
  - [x] `StreamConsumersManager.destroy()` 等待 writer stop/flush
  - [x] `StreamConsumersManager.clearSession()` 等待会话 flush
  - [x] `AgentExecutor` finally 中 await `clearSession()`
  - [x] `BeforeQuitAgentSystemHook` await `destroy()`
- **状态**：[x] 已完成

### 任务 3.4：单元测试

- **描述**：测试异步写入逻辑。
- **验收标准**：
  - [x] 测试事件顺序正确
  - [x] 测试队列溢出处理
  - [x] 测试 `flush()` / `closeFile()`
  - [x] 测试 EventWriter / HistoryWriter 会话 flush
  - [x] `pnpm exec vitest run src/main/agent/streaming ...` 通过
- **状态**：[x] 已完成

### 任务 3.5：压力测试

- **描述**：验证高频写入性能。
- **验收标准**：
  - [x] 新增 100 events/s 基准流量单测
  - [x] 覆盖 1000 条 JSONL 写入后 flush 无丢失
  - [x] 设置宽松耗时阈值，避免正常 CI 环境下异常慢写盘被忽略
  - [x] 已覆盖批量写入、队列溢出和 flush 行为
- **状态**：[x] 已完成

### 任务 3.6：降级策略

- **描述**：实现同步写入降级。
- **验收标准**：
  - [x] 实现失败计数器
  - [x] 连续失败达到阈值后切换同步模式
  - [x] 增加环境变量开关 `COOBEE_AGENT_SYNC_STREAM_WRITES=1` / `SYNC_MODE=1`
  - [x] 增加降级日志
- **状态**：[x] 已完成

### 任务 3.7：可选 Worker 写盘路径

- **描述**：为高频 JSONL 落盘提供可选 Worker 通道，默认不改变当前稳定路径。
- **验收标准**：
  - [x] `AsyncJsonlWriter` 支持 `useWorker` 选项
  - [x] 支持环境变量 `COOBEE_AGENT_STREAM_WRITE_WORKER=1`
  - [x] Worker append 失败时回退到普通异步 append
  - [x] `closeAll()` 会 flush 并关闭 Worker
  - [x] 增加 Worker 写盘路径测试
- **状态**：[x] 已完成

### 任务 3.8：Store 批量读取异步化

- **描述**：将列表/索引重建这类批量读文件路径迁到异步读取，降低主进程阻塞风险。
- **验收标准**：
  - [x] `ThreadStore.listAsync()` 使用异步目录扫描和并发读文件
  - [x] `ThreadStore.list()` 保留兼容入口并委托到异步实现
  - [x] 路由、RPC、启动恢复扫描迁移到 `listAsync()`
  - [x] `AgentStore.rebuildIndexAsync()` 使用异步目录扫描和并发读文件
  - [x] `AgentStore.listAsync()` 提供明确异步列表入口
  - [x] 内置 Agent seed 的批量读取改为异步
  - [x] 增加 ThreadStore / AgentStore 异步列表测试
- **状态**：[x] 已完成

---

## 阶段 4：测试与文档

### 任务 4.1：回归测试

- **描述**：全面回归测试。
- **验收标准**：
  - [x] P2 相关文件定向 eslint 通过
  - [x] `pnpm run typecheck:node` 通过
  - [x] `pnpm test` 通过
  - [-] 手动测试：创建 Agent/Thread 本轮未执行
  - [-] 手动测试：执行 Agent 高频输出场景本轮未执行
  - [-] 手动测试：热重载 Skill 本轮未执行
- **状态**：[~] 自动化回归完成，手动测试待后续

### 任务 4.2：性能基准测试

- **描述**：建立性能基准。
- **验收标准**：
  - [x] 新增 100 events/s 基准流量自动化烟测
  - [x] 覆盖无丢失、顺序完整和耗时阈值
  - [x] 已通过单元测试覆盖批量队列行为
- **状态**：[x] 已完成

### 任务 4.3：更新架构文档

- **描述**：更新事件写入流程和 Skill 文档。
- **验收标准**：
  - [x] 更新 `docs/architecture/agent-execution-flow.md`
  - [x] 更新 `docs/architecture/agent-module-review.md`
  - [x] 更新 `docs/architecture/README.md`
  - [x] 更新 `src/main/agent/README.md`
- **状态**：[x] 已完成

### 任务 4.4：迁移指南（可选）

- **描述**：创建迁移指南。
- **验收标准**：
  - [-] 未新增独立迁移指南
  - [x] 已在 `core-skills-injection.md` 和 `skills-injection-change.md` 中写明迁移说明
- **状态**：[~] 文档内说明完成，独立指南后续可补

---

## 成功标准对照

- [x] EventWriter / HistoryWriter 改为异步队列写入
- [x] 提供 flush / close 机制，常规退出路径可落盘
- [x] CoreSkills 主路径残留已清理
- [x] Skill 缓存与 Extension 装卸联动
- [x] Node 类型检查通过
- [x] P2 定向测试通过
- [x] 全量测试通过
- [x] Store 批量读取异步化已落地
- [x] 可选 Worker 写盘路径已落地
- [x] 100 events/s 自动基准烟测已落地
