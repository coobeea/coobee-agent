# Prompt 组合结构整理 - 待办事项

> 创建时间：2026-04-23

## 状态说明

- [ ] 待处理
- [x] 已完成

## 待办事项

### 1. 停止全局 AGENTS.md 注入

- **描述**：PromptAssemblyService 不再读取全局 `.home/agents.md`。
- **验收标准**：
  - [x] assemble 不再生成 `system_agents_md`
  - [x] 全局 path 即使传入也不会注入内容
  - [x] Agent 级 AGENTS.md 仍可注入
- **状态**：[x] 已完成

### 2. Agent rules 独立成块

- **描述**：Agent 级 `AGENTS.md` 输出为 `<agent_rules>`。
- **验收标准**：
  - [x] block id 为 `agent_rules`
  - [x] 内容包含 Agent 级文件路径
  - [x] 模板-only 文件会跳过
- **状态**：[x] 已完成

### 3. Agent Home 不再承载 AGENTS.md

- **描述**：Agent Home 注入只包含身份、人格、用户偏好、备注和心跳等文件。
- **验收标准**：
  - [x] `readInjectableFiles()` 不再遍历 `AGENTS.md`
  - [x] 规则仍由 `agent_rules` 块负责
- **状态**：[x] 已完成

### 4. 精简 runtime environment

- **描述**：缩短系统生成路径说明，减少重复强调。
- **验收标准**：
  - [x] 保留 Agent、Session、Model、Security、Extensions
  - [x] 保留 dataDirectory、agentHome、workspace、config、skills 路径
  - [x] 保留输出位置规则
  - [x] 删除冗长目录树和重复重要提示
- **状态**：[x] 已完成

### 5. 验证

- **描述**：运行格式化、定向测试和 Node 类型检查。
- **验收标准**：
  - [x] PromptAssemblyService 测试通过
  - [x] Agent 相关定向测试通过
  - [x] `pnpm run typecheck:node` 通过
- **状态**：[x] 已完成
