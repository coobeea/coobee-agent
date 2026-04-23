# Agent 模块 P1 阶段重构 - 问题记录

> 创建时间：2026-04-22
> 最后更新：2026-04-23
> 当前状态：P1 相关文件已清理通过，仍存在仓库级既有问题

## 问题列表

### 问题 #1：PromptAssemblyService 初版测试被总字符预算提前截断

**发现时间**：2026-04-23

**问题描述**：
`PromptAssemblyService.test.ts` 在 workspace context 场景中，`workspaceTotalChars` 设置过小，导致 `### a.md` 片段在总预算截断前被吞掉，测试断言失败。

**影响范围**：

- [ ] 阻塞当前任务
- [x] 影响测试稳定性
- [ ] 影响运行时逻辑

**根本原因**：
测试数据和总预算设置不匹配，命中了整体截断逻辑，而不是验证目标的“文件内容被装配”逻辑。

**解决方案**：
把测试里的 `workspaceTotalChars` 从 `180` 调整为 `500`，让断言聚焦到块装配本身。

**状态**：

- [x] 已解决

---

### 问题 #2：`pnpm run typecheck:web` 存在仓库既有前端类型错误

**发现时间**：2026-04-23

**问题描述**：
P1 收尾验证时，`pnpm run typecheck:web` 失败，报错集中在 renderer 侧，与本次 agent 模块改造没有直接耦合。

**典型报错文件**：

- `src/renderer/src/components/agent/AgentsPanel.vue`
- `src/renderer/src/components/agent/preview/MarkdownPreview.vue`
- `src/renderer/src/components/agent/VoicePanel.vue`
- `src/renderer/src/views/ThreadView.vue`

**影响范围**：

- [ ] 阻塞 P1 代码提交前的本地验证
- [x] 影响仓库全绿状态
- [x] 影响阶段 5.2 的完全通过

**根本原因**：
仓库当前 renderer 侧已有未收敛的类型问题，不是本轮 `src/main/agent` 重构引入。

**解决方案**：
作为独立前端治理任务处理，不在本轮 P1 agent 重构内展开。

**状态**：

- [ ] 待处理

---

### 问题 #3：`pnpm run lint` 存在仓库既有 lint 错误

**发现时间**：2026-04-23

**问题描述**：
P1 收尾验证时，`pnpm run lint` 失败。P1 相关文件已通过定向 eslint，但全仓库 lint 仍被 renderer、tests 以及部分历史 Node 侧文件阻塞。

**典型报错类型**：

- `@typescript-eslint/no-explicit-any`
- `@typescript-eslint/no-unused-vars`
- `@typescript-eslint/explicit-function-return-type`
- `prettier/prettier`

**影响范围**：

- [ ] 阻塞 P1 本地代码运行
- [x] 影响仓库 lint 全绿
- [x] 影响阶段 5.3 的完全通过

**根本原因**：
仓库历史代码尚未完全符合当前 ESLint 规则集。本轮已清理 P1 相关文件自身 lint 问题，但未尝试整体清理全仓库。

**解决方案**：
拆成单独的 lint 治理任务，按目录逐步收敛。

**状态**：

- [ ] 待处理

## 当前结论

- P1 本轮新增代码已完成，并通过 P1 定向 eslint、Node 侧类型检查和全量测试。
- 当前未解决问题主要是仓库级 `typecheck:web` 和 `lint` 基线，不属于本轮 agent 模块核心改造的直接回归。
