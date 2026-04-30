# 输入框 Ctrl 长按 AI 润色 - BUGS

当前仍处于 POC 阶段，尚未实现代码。

## 已知风险

- `app-copilot` 当前系统提示词偏“应用管家”，用于润色时必须用强约束 prompt，避免输出解释或多句回复。
- 如果后端只提供非流式 RPC，初版无法像旧项目一样实时预览生成片段。
- TipTap ChatInput 是 contenteditable/editor 实例，不能完全按普通 `input.value` 处理，需要单独适配。
- Ctrl/Control 长按可能与浏览器或系统快捷键冲突，需要只在输入框聚焦且没有其他组合键时触发。

