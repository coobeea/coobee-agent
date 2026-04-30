# Agent Home 运行目录重定义 - BUGS

当前暂无已知阻塞问题。

## 问题记录

| 时间 | 问题 | 影响 | 状态 |
|------|------|------|------|
| 2026-04-30 | 本地仍存在旧目录 `.home/workspaces/307549385198301184`，但没有对应 `.home/threads/307549385198301184.json`，无法可靠判断所属 Agent。 | 不影响新运行期路径；新代码不会 fallback 读取该目录。 | 已记录，暂不自动迁移或删除 |
| 2026-04-30 | `pnpm run typecheck:web` 和 `pnpm run typecheck:node` 仍有既有类型错误，集中在旧 store/API 调用、预览组件、旧 runtime 测试、CompressionService 模型类型等位置。 | 不影响本次已覆盖的目录布局单测；但全量类型检查仍无法作为验收绿灯。 | 非本任务新增，已在最终验证中说明 |
