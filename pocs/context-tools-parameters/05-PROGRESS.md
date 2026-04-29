# context.jsonl 工具参数 Schema 缺失 - PROGRESS

> 创建时间：2026-04-28

## 进度记录

| 日期       | 内容                                    | 状态      |
| ---------- | --------------------------------------- | --------- |
| 2026-04-28 | POC 文档创建，问题定位完成              | ✅ 完成   |
| -          | T1: writeSnapshot 添加 parameters       | ⬜ 待开始 |
| -          | T2: buildRequestPreview 添加 parameters | ⬜ 待开始 |
| -          | T3: ClaudeAgentRuntime 同步检查         | ⬜ 待开始 |
| -          | T4: stripSchemaRef 提取                 | ⬜ 待开始 |
| -          | T5: 验证                                | ⬜ 待开始 |

### 2026-04-29

- 定位并修复 BUG-001：PiMono `customTools` 被空 `tools` allowlist 过滤，导致工具没有进入 SDK 活跃工具表。
- 修改文件：`src/main/agent/runtime/pimono/PiMonoAgentRuntime.ts`
- 新增测试：`src/main/agent/runtime/pimono/__tests__/PiMonoAgentRuntime.tools.test.ts`
