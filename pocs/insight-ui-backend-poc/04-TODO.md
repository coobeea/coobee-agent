# Insight UI + Backend POC - 待办事项

> 创建时间：2026-04-24
> 关联目录：`pocs/insight-ui-backend-poc`

## 状态说明

- [ ] 待处理
- [x] 已完成
- [-] 已取消

## 待办事项

### 1. 收敛 `src/shared/types/insight.ts` 与 POC 最小数据模型

- **目标**：确认当前共享类型能支撑最小闭环实现，并只做必要补充。
- **背景**：当前项目已有 `src/shared/types/insight.ts`，但还没有真实实现验证这些字段是否足够。
- **涉及范围**：
  - `src/shared/types/insight.ts`
- **具体动作**：
  - 检查 `AnalysisTemplate`、`InsightSession`、`AnalysisSnapshot`、`AnalysisResult` 是否足够支撑“模板 -> 会话 -> 分析 -> 快照 -> 历史回看”
  - 明确首轮只支持的触发类型和会话状态
  - 需要新增字段时，优先做增量补充，不推翻已有命名
- **非目标**：
  - 本项不实现具体后端逻辑
- **验收标准**：
  - [x] 形成一版可用于前后端共同依赖的最小 Insight 数据模型
  - [x] 字段调整有明确理由和兼容说明
- **状态**：[x]

### 2. 新增 `src/main/insight/` 最小后端骨架

- **目标**：在当前项目中建立 Insight 模块后端主目录和职责划分。
- **背景**：当前项目还没有 `src/main/insight` 实现，后续开发缺少承载位置。
- **涉及范围**：
  - `src/main/insight/InsightOrchestrator.ts`
  - `src/main/insight/InsightAnalyzer.ts`
  - `src/main/insight/SessionManager.ts`
  - `src/main/insight/SnapshotStore.ts`
  - `src/main/insight/TemplateStore.ts`
  - `src/main/insight/builtin-templates.ts`
- **具体动作**：
  - 定义各模块职责边界
  - 明确 orchestrator 作为唯一对外入口
  - 约定存储结构、分析调用入口、模板加载方式
- **验收标准**：
  - [x] `src/main/insight` 模块结构清晰
  - [x] 每个文件职责边界明确，无明显重复职责
- **状态**：[x]

### 3. 设计并实现 Insight HTTP 路由契约

- **目标**：为前端提供最小可用的 Insight 接口集。
- **背景**：当前项目 `src/main/gateway/http` 下未见 Insight 路由，前端无统一调用入口。
- **涉及范围**：
  - `src/main/gateway/http/insight.ts`
  - 路由注册入口
- **具体动作**：
  - 设计首轮接口：
    - 模板列表
    - 创建会话
    - 查询活跃会话
    - 追加文本
    - 手动触发分析
    - 查询快照列表
    - 查询会话详情
  - 统一返回格式并补齐错误处理
- **非目标**：
  - 本项不做模板编辑 CRUD
- **验收标准**：
  - [x] 前端可仅通过 HTTP 调用完成首轮闭环
  - [x] 接口命名与当前项目网关风格一致
- **状态**：[x]

### 4. 设计 `InsightAnalyzer` 与当前项目 Agent/Channel 的连接方式

- **目标**：明确 Insight 分析如何复用当前项目已有 Agent / Channel 能力。
- **背景**：参考项目通过 `executeAgent` 触发分析；当前项目需找到最贴合的调用点。
- **涉及范围**：
  - `src/main/insight/InsightAnalyzer.ts`
  - `src/main/channels/*`
  - 相关 Agent 执行入口
- **具体动作**：
  - 确认使用哪个运行入口执行分析
  - 约定分析 prompt 的拼装方式
  - 约定 JSON 输出解析和失败回退策略
- **验收标准**：
  - [x] 分析调用链路有明确入口
  - [x] 失败时有默认降级行为，不会导致前端断流
- **状态**：[x]

### 5. 设计会话与快照持久化目录结构

- **目标**：确定 Insight 数据在当前项目中的落盘方式。
- **背景**：参考项目中会话、转写、快照分别持久化；当前项目需结合自身目录习惯设计。
- **涉及范围**：
  - `src/main/insight/SessionManager.ts`
  - `src/main/insight/SnapshotStore.ts`
  - 相关数据目录约定
- **具体动作**：
  - 设计会话元信息、文本、快照、最新结果的文件结构
  - 明确按日期分目录还是按 sessionId 分目录
  - 明确读写原子性和恢复策略
- **验收标准**：
  - [x] 单个会话的数据组织清晰
  - [x] 可支持会话列表与历史详情查询
- **状态**：[x]

### 6. 新增前端 Insight 页面与路由入口

- **目标**：在当前项目中建立可访问的 Insight 页面入口。
- **背景**：当前项目前端尚未接入 Insight 页面。
- **涉及范围**：
  - `src/renderer/src/router/index.ts`
  - `src/renderer/src/layout/Sidebar.vue`
  - `src/renderer/src/views/InsightView.vue`
  - `src/renderer/src/views/InsightSessionView.vue`
- **具体动作**：
  - 新增 `/insight` 主页面路由
  - 新增 `/insight/session/:id` 历史详情路由
  - 视需要在侧边栏增加入口
  - 主页面先包含：模板选择、当前会话、结果区、快照区
- **验收标准**：
  - [x] 用户可从前端进入 Insight 页面
  - [x] 历史详情页可通过 sessionId 打开
- **状态**：[x]

### 7. 新增前端 `src/renderer/src/api/insight.ts` 封装

- **目标**：统一前端对 Insight 后端的访问方式。
- **背景**：当前项目尚无 Insight API 封装，页面直接散落调用会导致维护困难。
- **涉及范围**：
  - `src/renderer/src/api/insight.ts`
- **具体动作**：
  - 封装模板查询、会话创建、文本追加、手动分析、结果查询、快照查询接口
  - 保持与现有前端 API 模块风格一致
- **验收标准**：
  - [x] Insight 页面不直接拼接裸请求
  - [x] API 方法命名和返回结构统一
- **状态**：[x]

### 8. 新增 `DimensionRenderer` 与 `SnapshotTimeline` 两个核心组件

- **目标**：建立最小可复用的 Insight 可视化组件。
- **背景**：参考项目把维度渲染和时间线抽成独立组件，适合当前项目复用。
- **涉及范围**：
  - `src/renderer/src/components/insight/DimensionRenderer.vue`
  - `src/renderer/src/components/insight/SnapshotTimeline.vue`
- **具体动作**：
  - `DimensionRenderer` 先支持 `enum`、`score`、`text`、`list`、`boolean`、`tags`
  - `SnapshotTimeline` 支持快照列表展示和切换
  - 组件 props 与 `src/shared/types/insight.ts` 对齐
- **验收标准**：
  - [x] 主页面与详情页都能复用这两个组件
  - [x] 组件输入输出边界清晰，不依赖页面私有状态
- **状态**：[x]

### 9. 建立最小端到端闭环验证

- **目标**：验证“创建会话 -> 追加文本 -> 手动分析 -> 查看快照”的核心链路。
- **背景**：如果没有闭环验证，POC 很容易停留在文件组织层而不是能力层。
- **涉及范围**：
  - 后端 Insight 路由与编排器
  - 前端页面与 API
- **具体动作**：
  - 创建内置模板
  - 启动会话
  - 提交一段文本
  - 触发分析
  - 展示结果和快照
- **验收标准**：
  - [x] 用户能看到分析结果
  - [x] 会话历史可回看至少一个快照
  - [x] 异常时前端能给出错误提示
- **状态**：[x]

### 10. 规划第二阶段增强项

- **目标**：把不适合首轮实现的能力明确后置，避免实施过程中范围失控。
- **背景**：参考项目还有自动触发、暂停恢复、模板编辑、推送替代轮询等能力，不应在首轮混入。
- **涉及范围**：
  - `pocs/insight-ui-backend-poc/02-方案设计.md`
  - `pocs/insight-ui-backend-poc/03-反思优化.md`
- **具体动作**：
  - 明确第二阶段增强列表
  - 标记哪些需要依赖首轮 POC 结果再决定
- **验收标准**：
  - [ ] 首轮范围稳定，不因增强需求频繁返工
  - [ ] 后续迭代入口明确
- **状态**：[ ]

### 11. 为实时洞察创建流程增加“智能体选择”

- **目标**：让用户在创建实时洞察会话时，不仅能选分析模板，还能明确选择本次执行分析的智能体。
- **背景**：当前 Insight 创建流程只支持模板选择，分析执行在后端写死为 `app-copilot`，无法满足按业务场景切换分析智能体的需求。
- **涉及范围**：
  - `src/shared/types/insight.ts`
  - `src/shared/api/insight-types.ts`
  - `src/main/insight/InsightOrchestrator.ts`
  - `src/main/insight/InsightAnalyzer.ts`
  - `src/main/insight/SessionManager.ts`
  - `src/main/routes/InsightRoutes.ts`
  - `src/renderer/src/views/InsightView.vue`
  - `src/renderer/src/views/InsightSessionView.vue`
- **具体动作**：
  - 在 Insight 会话配置中补充所选智能体的 `agentId/agentName`
  - 扩展创建会话请求体，允许前端显式提交 `agentId`
  - 创建会话时校验并持久化所选智能体，分析执行时优先使用该智能体
  - 将主页面创建弹窗调整为“选择模板 + 选择智能体”
  - 在会话界面和详情页补充当前使用智能体的展示
- **非目标**：
  - 本项不新增智能体管理页面能力
  - 本项不改动 Insight 结果区和详情页的整体结构
- **验收标准**：
  - [x] 创建实时洞察时可同时选择模板和智能体
  - [x] 后端分析链路不再写死 `app-copilot`
  - [x] 会话创建后可在主页面或详情页看到当前分析智能体
- **状态**：[x]

### 12. 支持自定义 Insight 模板与分析模块配置

- **目标**：允许用户在创建实时洞察前自定义模板，并在模板中配置多个分析模块，每个模块都能单独定义分析提示词。
- **背景**：当前模板只有后端内置项，无法按业务场景灵活新增模板，也无法让用户自行定义“分析什么”和“怎么分析”。
- **涉及范围**：
  - `src/shared/api/insight-types.ts`
  - `src/main/insight/TemplateStore.ts`
  - `src/main/insight/storage.ts`
  - `src/main/insight/InsightOrchestrator.ts`
  - `src/main/routes/InsightRoutes.ts`
  - `src/renderer/src/api/insight.ts`
  - `src/renderer/src/views/InsightView.vue`
- **具体动作**：
  - 为自定义模板新增创建接口和请求类型
  - 将模板存储从“仅内置模板”扩展为“内置模板 + 用户自定义模板”
  - 将自定义模板持久化到 `.home/insight/templates/`
  - 在实时洞察新建弹窗中提供“去模板定义页”入口，而不是在弹窗内直接编辑模板
  - 新增独立路由页面承载模板编辑器
  - 在模板编辑器中支持添加多个分析模块，并为每个模块填写名称、提示词和基础展示类型
- **非目标**：
  - 本项不实现模板删除和编辑历史
  - 本项不单独新增模板管理页面
- **验收标准**：
  - [x] 用户可在前端新建自定义模板
  - [x] 自定义模板支持多个分析模块和每个模块单独的提示词
  - [x] 新建模板保存后可立即用于创建实时洞察会话
  - [x] 模板定义使用独立路由页面，不在创建弹窗内二次编辑
- **状态**：[x]
