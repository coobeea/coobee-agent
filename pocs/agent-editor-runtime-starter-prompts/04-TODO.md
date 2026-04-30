# 智能体编辑页运行配置与快捷问题 - TODO

## 1. 修复 AgentStore metadata 局部保存语义

- **目标**：避免快捷问题自动保存时覆盖开场白、数据目录等其他 metadata 字段。
- **范围**：`src/main/agent/agents/AgentStore.ts`
- **动作**：`update` 中收到 `params.metadata` 时与现有 `existing.metadata` 浅合并。
- **验收标准**：局部更新 `starterPrompts` 后，已有 `greeting` 和 `dataDirectory` 仍存在。
- **状态**：[x]

## 2. 收敛 AgentEditorView 快捷问题状态和提交逻辑

- **目标**：支持连续添加多个快捷问题，并避免未点击添加的输入内容丢失。
- **范围**：`src/renderer/src/views/AgentEditorView.vue`
- **动作**：增加快捷问题归一化、统一 metadata 构造、中文输入法回车处理、最终保存前提交当前输入。
- **验收标准**：可以添加多条快捷问题；中文输入法回车不会提前添加；保存 payload 包含完整快捷问题数组；整页保存不会被旧的自动保存覆盖。
- **状态**：[x]

## 3. 优化默认运行配置选中态

- **目标**：让当前 Runtime 一眼可见。
- **范围**：`src/renderer/src/views/AgentEditorView.vue`
- **动作**：增加当前选中标签、图标、边框高亮和勾选状态；保留 ASR/TTS/思维链开关。
- **验收标准**：默认运行配置的当前值和选中卡片有明确视觉区分。
- **状态**：[x]

## 4. 增加回归测试

- **目标**：防止 metadata 局部保存回退为整体覆盖。
- **范围**：`src/main/agent/agents/__tests__/AgentStore.async-list.test.ts`
- **动作**：新增测试覆盖快捷问题多条局部保存与清空。
- **验收标准**：目标测试通过。
- **状态**：[x]
