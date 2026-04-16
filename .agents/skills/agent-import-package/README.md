# Agent Import Package Specification

智能体导入包结构规范 Skill。

## 用途

当需要帮助用户创建智能体导入包时，AI 助手会参考此规范，确保生成的 ZIP 包符合标准格式。

## 核心内容

- **ZIP 包标准结构**：定义了必需和可选文件
- **文件格式规范**：详细说明 `manifest.json`、`agent.json` 和人格文件的格式
- **制作流程**：手动和自动两种制作方法
- **验证清单**：确保导入包的正确性
- **示例导入包**：最小和完整导入包的实例

## 使用场景

1. 用户请求创建智能体导入包
2. 用户询问导入包的格式要求
3. 需要验证导入包的正确性
4. 制作可分享的智能体模板

## 相关文档

- 设计文档：`docs/01-designs/04-agent-import-export-format.md`
- 实现代码：`src/main/agent/agents/AgentImportExport.ts`
