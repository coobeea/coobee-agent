# Thread / Session / History / Events 持久化边界漂移

## 发现日期

2026-04-23

## 问题概述

当前的持久化拆分设计本身是合理的：

- `threads/{id}.json` 负责 Thread 元数据
- `workspaces/{id}/sessions/...` 负责 SDK 会话
- `workspaces/{id}/history.jsonl` 负责前端历史
- `workspaces/{id}/events.jsonl` 负责调试事件

但真实代码里，这几层已经开始出现“职责回流”和“语义混用”，主要表现为：

1. Thread 元数据层开始承担 Agent / Workspace 的副作用
2. 前端历史层不再是纯事件投影，而是依赖执行入口手工补数据
3. 读取接口和真实数据源之间已经出现概念错位
4. 事件层同时存在新旧两套实现，边界没有收干净

这类问题短期未必直接变成 bug，但它会让“哪个文件才是哪个语义的真相源”越来越不清楚。

## 问题详情

### 1. `ThreadStore` 不再只是保存 Thread 元数据

按设计，`ThreadStore` 应该只负责 `threads/{id}.json` 的持久化。

但当前 `ThreadStore.create()` 在写入 ThreadDefinition 之外，还做了多件跨边界的事情：

1. 创建 workspace 目录
2. 确保 Agent 的 `dataDirectory` 存在
3. 追加写入 Agent Home 下的 `sessions.jsonl`

这意味着 Thread 元数据层已经开始直接驱动：

- Workspace 层初始化
- Agent 层元数据补全
- Agent Home 层会话索引维护

也就是说，创建一个 Thread 不再只是“写一份 Thread 定义”，而是在隐式触发多层持久化副作用。

### 2. `ThreadDefinition` 里已经存了不少“可推导字段”

当前 `ThreadDefinition` 中有几个字段并不是真正稳定的业务元数据：

1. `sessionId`
   - 代码里明确 `sessionId = id`
   - 当前系统下它其实是重复字段

2. `agentHomePath`
   - 本质上可以由 `agentId` + Env 配置推导
   - 但现在被持久化进 ThreadDefinition

3. `agentName`
   - 来源于 Agent 定义快照
   - 一旦 Agent 改名，Thread 中的值就可能与当前 Agent 定义脱节

其中最典型的是 `agentHomePath`：

- `ThreadStore.create()` 会把它写进 ThreadDefinition
- `toIndexEntry()` 曾经需要兼容性地修正旧版 Agent Home 路径

这已经说明 Thread 元数据里保存了会随着目录迁移而陈旧的文件系统路径。

换句话说，这一层已经不再只是“业务定义”，而开始夹带“运行环境快照”。

### 3. `history.jsonl` 不是纯投影，而是依赖入口手工补写

按设计，`history.jsonl` 看起来应该是从流式事件里聚合出来的前端历史视图。

但当前 `HistoryWriter` 并不能仅靠事件流还原完整历史，因为用户消息并不在流事件里。

因此 `AgentExecutor` 需要在执行前手工调用：

```typescript
streamConsumersManager.writeUserMessage(sessionId, message);
```

这带来的问题是：

1. `history.jsonl` 不再是“单纯从 event stream 投影出的结果”
2. 它反而依赖调用入口记得主动补写用户消息
3. 如果未来新增一个执行入口忘了调 `writeUserMessage()`，历史就会残缺

这就是很典型的边界漂移：本来应该是消费层自己的投影逻辑，现在反过来依赖生产侧入口配合。

### 4. 读取接口的命名和真实数据源已经错位

`ThreadRoutes` 中有个方法名叫：

```typescript
extractMessagesFromSession(...)
```

注释也写的是“从 session 文件中提取完整的对话消息”。

但它真正读取的却是：

```typescript
workspaces / { id } / history.jsonl;
```

这说明在接口语义上，已经把：

- SDK session
- 前端历史投影

这两层概念混用了。

这不是单纯的命名问题，它会影响后续开发者的判断：

- 我看到 “fromSession”，会以为这是从 SDK 会话真相源读取
- 但实际上拿到的是已经聚合、已经降维的前端视图

一旦有人基于这个误解继续扩展功能，就很容易把更多逻辑叠到错误的数据层上。

### 5. 事件层同时存在新旧两套写入路径

当前主路径里的事件持久化，是：

```text
StreamEmitter -> EventBus -> streaming/consumers/EventWriter -> workspaces/{id}/events.jsonl
```

但代码里还保留着旧的 `AgentEventWriter`：

1. 它自己也负责写事件文件
2. 它使用的路径仍是 `workspace/events/events.jsonl`
3. `ExtensionApi.services.events.emit()` 仍然依赖它来发事件

这说明事件层目前至少有两套抽象同时存在：

1. 新链路：`StreamEmitter + EventBus + EventWriter`
2. 旧链路：`AgentEventWriter`

而且这两套链路对应的落盘位置都不一样。

更麻烦的是，当前代码搜索没有看到 `AgentEventWriter` 在主执行链路里被实例化和注册，这意味着它已经明显脱离主链路，但对外 API 仍然在引用它。

这就是典型的“抽象已经迁走，但边界没有清理干净”。

### 6. `threads/{id}.json` 和 Agent Home `sessions.jsonl` 都在描述“会话归属”

当前一个 Thread 被创建时：

1. 会写 `threads/{id}.json`
2. 还会再追加到 `agents/{agentId}/sessions.jsonl`

这两个文件都在描述“这个会话属于哪个 Agent”，只是粒度不同：

- ThreadDefinition 是完整定义
- Agent Home sessions.jsonl 是追加式索引

问题不在于索引存在，而在于这份索引是由 `ThreadStore` 直接维护的。

也就是说 Thread 元数据层不仅保存主数据，还要顺手维护另一份衍生索引。

只要后续 Thread 删除、Agent 迁移、归属变更等场景再复杂一点，这两层就很容易出现不同步风险。

## 为什么这是不合理的

### 1. 真相源和投影层开始互相穿透

健康的结构应该是：

- 真相源负责产生原始状态
- 投影层只消费真相源并生成视图

但现在已经出现：

- Thread 层去改 Agent/Workspace 状态
- 历史层反过来依赖执行入口补写
- API 把 session 和 history 视作同一层

这会让“谁依赖谁”越来越模糊。

### 2. 可推导字段被持久化后，会引入迁移成本和陈旧数据

像 `agentHomePath`、`sessionId = id`、`agentName` 这种字段，一旦被长期存进 ThreadDefinition：

- 目录迁移要做兼容修正
- Agent 改名会产生快照漂移
- 不同读取路径可能拿到不一致数据

### 3. 旧抽象残留会让调试成本持续上升

当代码里同时存在：

- `EventWriter`
- `HistoryWriter`
- `AgentEventWriter`
- `ThreadRoutes.extractMessagesFromSession()`

而它们对“历史”“事件”“会话”的理解又不完全一致时，后续排查问题会越来越困难。

## 影响范围

### 受影响的能力

- Thread 创建和初始化流程
- Agent Home 会话索引
- 历史消息展示
- 调试事件落盘
- 扩展发事件能力
- 目录迁移和兼容逻辑

### 典型风险

1. 新入口遗漏 `writeUserMessage()`，导致历史记录缺失用户消息
2. 代码以为读的是 session 真相源，实际读到的是 history 投影
3. 旧 `AgentEventWriter` 路径和新 `events.jsonl` 路径并存，导致事件源理解混乱
4. `ThreadDefinition` 中的路径/名称快照随着迁移或配置变更逐渐陈旧

## 优先级

高

这是结构边界问题，不一定马上爆炸，但会持续放大理解成本和改造成本。

## 建议修复方向

### 方向 1：明确“真相源 / 投影 / 索引”三种层次

建议后续明确区分：

1. 真相源
   - `threads/{id}.json`
   - `sessions/...`

2. 投影
   - `history.jsonl`
   - `events.jsonl`
   - `context.jsonl`

3. 索引
   - `agents/{agentId}/sessions.jsonl`

这三种层次应该有清晰单向依赖，避免互相写回。

### 方向 2：ThreadStore 收回到“只保存 Thread 定义”

后续建议把以下逻辑从 `ThreadStore` 里拿出去：

1. `ensureAgentDataDirectory()`
2. `appendToAgentSessionIndex()`
3. 目录创建之外的 Agent 相关补全逻辑

ThreadStore 应该尽量只关心 Thread 定义本身。

### 方向 3：减少 ThreadDefinition 中的可推导字段

后续可优先评估移除或弱化这些字段：

1. `sessionId`
2. `agentHomePath`
3. `agentName`

至少要明确哪些是“快照字段”，哪些是“真相字段”。

### 方向 4：让 `history.jsonl` 真正成为单向投影

后续需要二选一：

1. 把用户消息也纳入统一事件流，再由 `HistoryWriter` 完整投影
2. 明确规定 `history.jsonl` 是入口驱动写入的派生文件，并把这个约束收敛到统一入口

否则当前这种“半投影半手写”的状态会继续制造遗漏点。

### 方向 5：统一事件落盘链路

后续建议只保留一套事件写入抽象：

1. 要么彻底收敛到 `EventBus -> EventWriter`
2. 要么重新明确 `AgentEventWriter` 的角色并接回主链路

但不能继续让两套路径共存且目录结构不同。

### 方向 6：修正 API / 注释中的语义错位

像 `extractMessagesFromSession()` 这种方法，至少要让名字和真实数据源一致。

如果读的是 `history.jsonl`，那就应该明确承认自己读的是“聚合历史视图”，而不是 SDK session。

## 相关文件

- `src/main/agent/threads/types.ts`
- `src/main/agent/threads/ThreadStore.ts`
- `src/main/agent/streaming/consumers/HistoryWriter.ts`
- `src/main/agent/streaming/consumers/EventWriter.ts`
- `src/main/agent/StreamConsumersManager.ts`
- `src/main/agent/AgentEventWriter.ts`
- `src/main/agent/extension/ExtensionApi.ts`
- `src/main/routes/ThreadRoutes.ts`

## 后续修改时的验证建议

1. 验证 Thread 创建时不再顺手修改 Agent 层状态
2. 验证历史文件在所有执行入口下都能完整记录用户与助手消息
3. 验证事件文件只有一套稳定落盘路径
4. 验证前端读取消息时，明确使用的是 history 视图还是 session 真相源
5. 验证目录迁移后，不再需要在 Thread 读取阶段做路径修正
