# Insight UI + Backend POC - 执行进度

> 创建时间：2026-04-24
> 当前状态：实施中

## 实施记录

### 2026-04-24

- 读取参考项目文档：`/Users/lifeng/git/git_agents/coobee-ai/docs/18-realtime-analysis/03-insight-ui-backend-overview.md`
- 核对当前项目现状：
  - 已存在 `src/shared/types/insight.ts`
  - 尚未发现完整的 `src/main/insight`、Insight 网关路由、前端 Insight 页面与 API 封装
- 已在当前项目创建 POC 文档目录：`pocs/insight-ui-backend-poc`
- 已完成文档：
  - `01-需求分析.md`
  - `02-方案设计.md`
  - `03-反思优化.md`
  - `04-TODO.md`

### 2026-05-03

- 完成了最小 Insight 后端骨架：
  - 新增 `src/main/insight/InsightOrchestrator.ts`
  - 新增 `src/main/insight/InsightAnalyzer.ts`
  - 新增 `src/main/insight/SessionManager.ts`
  - 新增 `src/main/insight/SnapshotStore.ts`
  - 新增 `src/main/insight/TemplateStore.ts`
  - 新增 `src/main/insight/builtin-templates.ts`
  - 新增 `src/main/routes/InsightRoutes.ts`
- 完成了前端接入：
  - 新增 `src/renderer/src/api/insight.ts`
  - 新增 `src/renderer/src/views/InsightView.vue`
  - 新增 `src/renderer/src/views/InsightSessionView.vue`
  - 新增 `src/renderer/src/components/insight/DimensionRenderer.vue`
  - 新增 `src/renderer/src/components/insight/SnapshotTimeline.vue`
  - 更新 `src/renderer/src/router/index.ts`
  - 更新 `src/renderer/src/layout/Sidebar.vue`
- 补充了共享类型与 API 契约：
  - 更新 `src/shared/types/insight.ts`
  - 新增 `src/shared/api/insight-types.ts`
- 实现说明：
  - 分析链路优先复用 `ThreadlessExecutor` 调用当前项目 Agent 能力
  - 当模型输出解析失败或运行异常时，自动回退到本地启发式分析，避免前端断流
  - 会话数据按 `sessionId` 落盘到 `.home/insight/sessions/<sessionId>/`，包含 `session.json`、`transcript.txt`、`latest-result.json` 和 `snapshots/*.json`
- 验证情况：
  - 新增文件已通过 IDE 诊断检查
  - `npm run typecheck` 未通过，但错误来自仓库既有文件，不是本次新增的 Insight 文件

- 对照旧项目 `coobee-ai` 的 `InsightView.vue` / `InsightSessionView.vue` 完成了一轮页面逻辑回调：
  - 将主页面重构为“实时分析 / 历史记录”双 tab 结构
  - 将主工作区改为“左侧文字流 + 右侧分析结果 + 底部快照时间线”
  - 将详情页改为旧版那种“顶部摘要信息 + 左文稿右结果 + 底部时间线”的回看布局
  - 为适配旧版工作流，补充了 `GET /gateway/insight/sessions` 和 `PUT /gateway/insight/sessions/:id/complete`
  - `DimensionRenderer` / `SnapshotTimeline` 已对齐旧版组件用法，支持变化趋势、图标和底部横向时间线

- 继续补齐了旧版的录音工作流：
  - 复用现有 `src/renderer/src/composables/useAudioRecorder.ts` 接入 `InsightView.vue`
  - 新增录音/文本双模式切换，模板选择弹窗支持“手动输入文本 / 实时录音”
  - 录音模式下支持音量显示、暂停、继续、静默触发分析
  - 为避免手动文本接口污染实时 transcript，新增 `POST /gateway/insight/sessions/:id/transcript`
  - 新增 `PUT /gateway/insight/sessions/:id/pause` 和 `PUT /gateway/insight/sessions/:id/resume`，用于录音态控制
- 完成了一轮视觉排版优化，重点不改功能只重排信息层次：
  - `src/renderer/src/views/InsightView.vue` 改为带 radial gradient 背景、顶部 hero、统计卡、玻璃卡片工作区和更高级的模板弹窗
  - `src/renderer/src/views/InsightSessionView.vue` 同步成与主页面一致的卡片式详情布局
  - 现有 `DimensionRenderer.vue` / `SnapshotTimeline.vue` 与页面整体风格进一步统一，形成更稳定的设计语言
- 创建实时洞察时补充了“模板 + 智能体”双选择：
  - `src/renderer/src/views/InsightView.vue` 在创建弹窗中新增智能体选择区，并将空态模板卡改为预选模板后进入创建弹窗
  - `src/shared/api/insight-types.ts` 与 `src/shared/types/insight.ts` 扩展了会话创建和会话配置中的 `agentId/agentName`
  - `src/main/insight/InsightOrchestrator.ts` / `InsightAnalyzer.ts` / `SessionManager.ts` 改为持久化所选智能体，并在分析时优先使用该智能体，而不是写死 `app-copilot`
  - `src/renderer/src/views/InsightSessionView.vue` 同步显示当前会话使用的智能体名称
- 新增了自定义模板能力：
  - `src/main/insight/TemplateStore.ts` 从仅内置模板扩展为“内置模板 + 用户自定义模板”，并将自定义模板持久化到 `.home/insight/templates/`
  - `src/shared/api/insight-types.ts`、`src/main/routes/InsightRoutes.ts`、`src/renderer/src/api/insight.ts` 增加了创建模板接口
  - `src/renderer/src/views/InsightView.vue` 在新建弹窗中改为提供“自定义模板”跳转入口，不再在弹窗内直接定义模板
  - 新增独立页面 `src/renderer/src/views/InsightTemplateEditorView.vue`，专门用于定义模板和分析模块
  - 自定义模板支持配置多个分析模块，每个模块可独立填写名称、提示词和基础展示类型，保存后会返回实时洞察页并自动预选新模板
- 补齐了自定义模板 CRUD 的后续链路：
  - `src/main/insight/InsightOrchestrator.ts` 暴露了模板单条查询、更新、删除能力
  - `src/main/routes/InsightRoutes.ts` 新增 `GET /gateway/insight/templates/:id`、`PUT /gateway/insight/templates/:id`、`DELETE /gateway/insight/templates/:id`
  - `src/renderer/src/api/insight.ts` 增加模板查询、更新、删除 API 封装
  - `src/renderer/src/router/index.ts` 新增 `insight/templates/:id/edit` 路由
  - `src/renderer/src/views/InsightTemplateEditorView.vue` 改为支持新建/编辑共用，并在编辑态提供删除入口
  - `src/renderer/src/views/InsightView.vue` 在模板选择弹窗中为自定义模板增加了“编辑”“删除”操作，删除后会自动刷新模板列表并回退到可用模板
  - 内置模板继续保持只读，不允许编辑或删除
- 验证情况补充：
  - 本轮修改的 `InsightRoutes.ts`、`InsightOrchestrator.ts`、`insight.ts`、`router/index.ts`、`InsightTemplateEditorView.vue`、`InsightView.vue` 已通过 IDE diagnostics 检查

## 下一步

- 启动应用并做一次真实手工闭环验证，确认页面可访问、路由可调用、快照可持久化。
- 评估是否需要单独的 Insight 分析 Agent，而不是继续复用 `app-copilot`。
- 处理仓库当前已有的全局 typecheck 错误后，再补一轮更完整的构建验证。
