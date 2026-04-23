# Agent 模块 P1 阶段重构 - 待办事项

> 创建时间：2026-04-22
> 最后更新：2026-04-23
> 方案：上策（完整重构）
> 当前分支：`main`

## 状态说明

- [ ] 待处理
- [x] 已完成
- [~] 已完成主体工作，但仍有仓库级尾项
- [-] 本轮不执行 / 待后续单独处理

## 当前结论

- [x] P1 核心代码改造已完成。
- [x] P1 文档已同步到当前实现。
- [x] P1 相关文件定向 eslint、Node 类型检查和全量测试均已通过。
- [~] 全仓库 `typecheck:web`、`pnpm run lint` 受仓库既有问题影响未全绿。
- [-] commit / PR 本轮未执行，待用户确认后统一处理。

---

## 任务清单

### 阶段 1：基础模块实现

#### 任务 1.1：实现 AgentContextResolver

- **描述**：新增 `src/main/agent/context/AgentContextResolver.ts`，统一路径和上下文解析。
- **验收标准**：
  - [x] 创建 `AgentContextResolver` 类
  - [x] 实现 `resolve()` 方法，返回 `AgentContext`
  - [x] 增加参数验证、错误处理、缓存、路径安全校验
  - [x] 编写单元测试
  - [x] `pnpm run typecheck:node` 通过
- **状态**：[x] 已完成

#### 任务 1.2：实现 ThreadExecutionFactory

- **描述**：新增 `src/main/agent/execution/ThreadExecutionFactory.ts`，统一 Builder 配置。
- **验收标准**：
  - [x] 创建 `ThreadExecutionFactory` 类
  - [x] 实现 `createBuilder()` 方法
  - [x] 调用 `AgentContextResolver` 解析上下文
  - [x] 配置 `sessionMode`、`name`、`applyProviderConfig`、`instructions`
  - [x] 处理空值和异常场景
  - [x] 编写单元测试
  - [x] `pnpm run typecheck:node` 通过
- **状态**：[x] 已完成

#### 任务 1.3：修正生命周期 priority

- **描述**：修改 `ReadyGatewayHook.ts` 的 priority，确保 READY 顺序和注释一致。
- **验收标准**：
  - [x] `ReadyGatewayHook.priority` 改为 45
  - [x] 执行顺序明确为 `Gateway(45) -> Agent(50) -> Config(55)`
  - [-] 生命周期集成测试本轮未补
  - [x] `pnpm run typecheck:node` 通过
- **状态**：[x] 已完成

---

### 阶段 2：集成到现有模块

#### 任务 2.1：重构 AgentStore

- **描述**：移除 AgentStore 中的运行期路径初始化逻辑。
- **验收标准**：
  - [x] 删除 `dataDirectory` 初始化和自动创建逻辑
  - [x] 保留 Agent 定义与 Agent Home 标准文件初始化职责
  - [x] `pnpm run typecheck:node` 通过
- **状态**：[x] 已完成

#### 任务 2.2：重构 ThreadStore

- **描述**：移除 `ThreadStore.ensureAgentDataDirectory()` 及相关路径补丁逻辑。
- **验收标准**：
  - [x] 删除 `ensureAgentDataDirectory()` 方法和调用
  - [x] 保留 Thread 元数据和 workspace 目录职责
  - [x] `pnpm run typecheck:node` 通过
- **状态**：[x] 已完成

#### 任务 2.3：重构 AgentEnvInjector

- **描述**：使用 `AgentContextResolver`，并在 P1 中继续接入 PromptAssemblyService。
- **验收标准**：
  - [x] 在 `injectEnv()` 中调用 `resolver.resolve()`
  - [x] 删除内部路径推导逻辑
  - [x] 接入 `PromptAssemblyService`
  - [x] 保持接口兼容
  - [x] `pnpm run typecheck:node` 通过
- **状态**：[x] 已完成

#### 任务 2.4：重构 ChatRoutes

- **描述**：使用 `ThreadExecutionFactory` 替代现有 Builder 配置代码。
- **验收标准**：
  - [x] 在发送消息主路径中调用 `factory.createBuilder()`
  - [x] 删除路由层重复 Builder 配置
  - [x] 接口保持兼容
  - [x] `pnpm run typecheck:node` 通过
- **状态**：[x] 已完成

#### 任务 2.5：重构 ThreadWaker

- **描述**：恢复路径改为和 ChatRoutes 共用 Builder 装配逻辑。
- **验收标准**：
  - [x] 在恢复路径中调用 `factory.createBuilder()`
  - [x] 删除重复 Builder 配置
  - [x] 删除 P0 遗留 TODO
  - [x] 线程恢复相关测试通过
- **状态**：[x] 已完成

---

### 阶段 3：事件链路统一

#### 任务 3.1：清理 AgentEventWriter

- **描述**：将 `AgentEventWriter` 收敛为 EventBus 兼容适配层。
- **验收标准**：
  - [x] 顶部增加 `@deprecated` 注释
  - [x] 旧方法内部改为转发到 EventBus
  - [x] 不再直接写 `events.jsonl`
  - [x] 增加针对主会话 / 子会话转发的测试
- **状态**：[x] 已完成

#### 任务 3.2：统一 OpenAI Runtime 事件模型

- **描述**：OpenAI Runtime 不再直接调用 `streamEmitter`，统一改用 `yield StreamChunk`。
- **验收标准**：
  - [x] `agent_updated` 改为 yield `agent:updated`
  - [x] 工具增量输出改为 yield `tool:delta`
  - [x] 删除 Runtime 内部的业务 `streamEmitter.forward()` 调用
  - [x] 相关测试通过
- **状态**：[x] 已完成

---

### 阶段 4：Prompt 拼装优化

#### 任务 4.1：实现 PromptAssemblyService

- **描述**：新增 `src/main/agent/prompt/PromptAssemblyService.ts`，统一 Prompt 拼装。
- **验收标准**：
  - [x] 创建 `PromptAssemblyService`
  - [x] 实现 `assemble()`，返回 `PromptBlock[]`
  - [x] 支持 runtime paths、AGENTS.md、Agent Home、workspace context、Skill discovery、Extension instructions
  - [x] 增加字符预算和 token 估算
  - [x] 编写单元测试
  - [x] `pnpm run typecheck:node` 通过
- **状态**：[x] 已完成

#### 任务 4.2：集成 PromptAssemblyService

- **描述**：在 `AgentEnvInjector` 中接入 `PromptAssemblyService`。
- **验收标准**：
  - [x] 使用 `assemblyService.assemble()` 替代内联拼装逻辑
  - [x] 删除 AGENTS.md / workspace markdown 的内联读取逻辑
  - [x] 保持 Prompt 块顺序可追踪
  - [x] 相关测试通过
- **状态**：[x] 已完成

#### 任务 4.3：修复 PiMono 双重注入

- **描述**：PiMono Runtime 不再把技能摘要重复注入到 appendInstructions。
- **验收标准**：
  - [x] 移除技能摘要拼接
  - [x] 保留 `resourceLoader.getSkills()`
  - [x] 验证 Prompt 中技能信息只保留一套来源
  - [x] 相关测试通过
- **状态**：[x] 已完成

---

### 阶段 5：文档和测试

#### 任务 5.1：更新架构文档

- **描述**：同步 P1 后的执行链路、模块职责和服务接口文档。
- **验收标准**：
  - [x] 在 `docs/architecture/agent-module-review.md` 中标记 P1 问题已解决，并补充后续待讨论项
  - [x] 更新 `docs/architecture/agent-execution-flow.md`
  - [x] 更新 `src/main/agent/README.md`
  - [x] 新增 `docs/architecture/agent-p1-services.md`
- **状态**：[x] 已完成

#### 任务 5.2：完整回归测试

- **描述**：运行类型检查和测试，确认 P1 改动没有引入回归。
- **验收标准**：
  - [x] `pnpm run typecheck:node` 通过
  - [-] `pnpm run typecheck:web` 未通过，存在仓库既有前端类型错误，详见 `06-BUGS.md`
  - [x] `pnpm test` 通过（`894 passed | 54 skipped`）
  - [-] 手动测试 Chat 模式本轮未执行
  - [-] 手动测试 Thread 恢复本轮未执行
  - [-] 手动测试工具调用本轮未执行
- **状态**：[~] 主体完成，受仓库现状限制

#### 任务 5.3：代码审查和提交

- **描述**：执行本地审查，确认改动范围合理。
- **验收标准**：
  - [x] P1 相关文件定向 eslint 通过
  - [-] 全仓库 `pnpm run lint` 未通过，存在仓库既有 lint 错误，详见 `06-BUGS.md`
  - [x] 已检查 `git diff --stat`
  - [-] commit message 未编写
  - [-] 未提交到分支 `refactor/p1-agent-module`
  - [-] 未创建 PR
- **状态**：[~] 本地审查完成，提交待用户确认

---

## 成功标准对照

- [x] P1 核心问题已完成代码收敛
- [x] Node 侧类型检查通过
- [x] P1 相关文件定向 eslint 通过
- [x] 全量测试通过
- [x] 文档已更新并和实现对齐
- [~] 仓库级 `typecheck:web` / `lint` 仍需单独治理
- [-] Git 提交与 PR 由后续独立步骤处理
