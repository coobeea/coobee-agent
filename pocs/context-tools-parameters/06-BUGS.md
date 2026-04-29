# context.jsonl 工具参数 Schema 缺失 - BUGS

> 创建时间：2026-04-28

## 已知问题

### BUG-001: PiMono customTools 被空 allowlist 过滤，导致模型无法真实调用工具

- **发现时间**：2026-04-29
- **严重程度**：阻塞
- **现象**：`context.jsonl` 的 `rawApiRequest.tools` 看起来有工具列表，但 `history.jsonl` 中 `toolCalls` 始终为空，`events.jsonl` 中也没有 `tool:start/tool:done`。模型回复会出现“我已执行文件写入工具”的文本，但实际文件没有创建。
- **原因**：`PiMonoAgentRuntime.createSessionConfig()` 传入 `customTools` 后又设置 `sessionConfig.tools = []`。Pi SDK 中 `tools` 是活跃工具 allowlist，空数组会把 custom tools 也过滤掉，最终活跃工具表为空。
- **解决方案**：将 `customTools` 设为转换后的工具定义，同时将 `tools` 设为这些工具的名称列表，作为 active tools allowlist。
- **状态**：已解决
