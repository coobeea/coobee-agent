# workspace/project 命名收敛 V1 · 风险与 Bug 跟踪

## 风险清单

### R1 · 迁移覆盖用户数据

**场景**：旧 `workspace/` 和新 `project/` 同时存在，迁移时覆盖目标目录。

**规避**：

- 预扫描阶段检测冲突。
- 目标存在且非空时默认中止。
- 不做静默 merge，除非后续专门设计目录合并策略。

### R2 · 迁移时序过晚

**场景**：Agent system 已经启动并创建了空 `project/`，随后迁移发现目标存在，导致迁移失败或数据不可见。

**规避**：

- 迁移放在最早 ready hook。
- 迁移完成前不初始化 Agent system。

### R3 · 内部 workspaceRoot 被误改

**场景**：为了追求术语统一，把 sandbox/tool 的 `workspaceRoot` 机械改为 `projectRoot`，导致工具上下文、测试和运行时构建大面积破裂。

**规避**：

- V1 明确不改内部通用执行根目录术语。
- 只改 LLM/用户可见语义和 Agent business dir。

### R4 · `COOBEE_WORKSPACE` 兼容问题

**场景**：旧 Skill 脚本读取 `COOBEE_WORKSPACE`，V1 如果直接删除会导致脚本失败。

**规避**：

- 新增 `COOBEE_PROJECT`。
- 是否保留 `COOBEE_WORKSPACE` 作为短期 alias 由实现阶段决定；即使保留，也不在 prompt 文案中推荐。

### R5 · Skill kind 改名漏掉字符串判断

**场景**：存在 `kind === 'workspace'` 的动态判断，类型改了但运行时逻辑漏改。

**规避**：

- grep `'workspace'` 和 `"workspace"`，重点检查 `skills/`。
- SkillManager 测试覆盖来源 kind 和 label。

### R6 · 历史文档被过度机械替换

**场景**：把历史 POC、prompt snapshot、旧日志里的 workspace 全部改成 project，破坏历史记录真实性。

**规避**：

- V1 只改活跃 Skill 文档和本 POC。
- 历史 reference snapshot 不改。

## 实施期间遇到的真实 Bug

### B1 · ThreadViewDual.vue search_replace 部分失败

**日期**：2026-04-30
**现象**：批量替换 9 处 `'workspace'` → `'session'` 时，`@click="openRightPanel('workspace')"` 出现两次导致非唯一匹配失败；`rightTab === 'workspace'` 被前序替换已变更导致二次匹配失败。
**解决**：对重复模式使用 `replace_all: true`；对已被变更的匹配确认无需再改。

## 收尾验证记录

### V1 合规检查（2026-04-30）

| 检查项                    | 方法                                      | 结果    |
| ------------------------- | ----------------------------------------- | ------- |
| R3: workspaceRoot 未误改  | grep `workspaceRoot` → 仍为内部字段名     | ✅ 通过 |
| R4: COOBEE_WORKSPACE 兼容 | 3 处引用均为"已废弃"说明                  | ✅ 通过 |
| R5: Skill kind 字符串判断 | grep `'workspace'` in skills/ → 0 matches | ✅ 通过 |
| R6: 历史文档未机械替换    | 仅修改活跃 resources/skills/ + 本 POC     | ✅ 通过 |
| 编译完整性                | `tsc --noEmit` exit 0                     | ✅ 通过 |
| SkillManager 回归         | 39/39 tests passed                        | ✅ 通过 |

### 已知残余 workspace 字符串（V1 非目标）

| 位置                     | 字符串                           | V1 不处理理由                         |
| ------------------------ | -------------------------------- | ------------------------------------- |
| ExtensionLoader.ts       | `'workspace'` (ExtensionOrigin)  | 内部类型值                            |
| AgentProjectMigration.ts | `'workspace'` (legacy dir)       | 迁移兼容逻辑                          |
| AgentRuntimeLayout.ts    | `'workspace'` (legacy dir)       | 迁移兼容逻辑                          |
| AgentStore.ts            | `'workspace'` (legacy dir)       | 迁移兼容逻辑                          |
| sandbox/\*               | `'/workspace'` (Docker workdir)  | Sandbox 执行根目录，非 Agent 业务目录 |
| useProjectWatcher.ts     | `workspace.file-changed` (event) | Gateway 事件名，V1 不改               |
| ProjectPanel.vue         | `@/api/workspace` (import)       | API 模块名，V1 不改                   |
| Test fixtures            | `'workspace'` (dir name)         | 测试数据，非生产代码                  |
