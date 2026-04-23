# Agent Runtime 选择被硬编码为 PiMono 的问题

## 发现日期
2026-04-23

## 问题概述
当前系统在 `AgentExecutor` 中同时暴露了 `piMono()` 和 `openai()` 两套 Runtime Builder，但实际主入口依然普遍直接写死为 `agentExecutor.piMono()`。

这意味着“系统内部支持两个 runtime”和“业务入口能够正确选择 runtime”其实是两回事。现在的真实情况更接近于：底层已经做了双 runtime 能力，但上层调用约定还停留在单 runtime 假设。

更具体地说，像下面这类写法：

```typescript
agentExecutor.piMono().sessionMode('file')
```

把两个本应分离的决策耦合到了同一行里：

1. **运行时实现选择**: `piMono()` 还是 `openai()`
2. **会话持久化语义**: `sessionMode('file')` 还是 `sessionMode('memory')`

`sessionMode('file')` 本身并不一定是错的，但它不应该和 runtime 选择一起被上层入口硬编码。

## 问题详情

### 1. 现状：多个入口直接写死 `piMono()`

目前已经确认的调用点包括：

1. `src/main/routes/ChatRoutes.ts`
   - `agentExecutor.piMono().sessionMode('file').name(agent.id)`
   - HTTP SSE 发送消息主入口直接绑定 PiMono

2. `src/main/rpc/ChatMethods.ts`
   - `agentExecutor.piMono().sessionMode('file').name(agent.id)`
   - RPC 发送消息主入口同样直接绑定 PiMono

3. `src/main/agent/threads/ThreadWaker.ts`
   - `const builder = agentExecutor.piMono()`
   - Thread 恢复链路没有复用统一的 runtime 选择逻辑

4. `src/main/common/ipc/agentHandlers.ts`
   - `const builder = agentExecutor.piMono()...`
   - IPC 默认执行入口直接把 PiMono 当成系统默认

5. `src/main/agent/extension/ExtensionApi.ts`
   - `agentExecutor.piMono().lightweight(true).mode('chat').sessionMode('memory')`
   - Extension 调用链也把 PiMono 和一组执行语义绑死在一起

### 2. `AgentExecutor` 有双 runtime 工厂，但没有统一选择层

`src/main/agent/AgentExecutor.ts` 已经明确暴露了：

```typescript
piMono(): PiMonoBuilder
openai(): OpenAIBuilder
```

但当前缺的不是“第二个 builder”，而是“谁来决定该用哪个 builder”。

也就是说，系统有 runtime factory，但没有 runtime selector。

### 3. 运行时选择没有进入领域模型

当前的 Agent / Thread 定义里，已经有：

- `AgentDefinition.model?: string`
- `ThreadDefinition.overrideModel?: string`

但还没有与之对应的 runtime 选择字段，例如：

- `AgentDefinition.runtime?: 'pimono' | 'openai'`
- `ThreadDefinition.overrideRuntime?: 'pimono' | 'openai'`

这会导致一个很现实的问题：即使我们以后希望“某个 Agent 默认跑 OpenAI runtime”，当前的数据结构也无法表达，最终只能继续让入口层手工判断。

### 4. 当前耦合方式会导致语义漂移

`piMono()`、`sessionMode('file')`、`mode('chat')`、`lightweight(true)` 这些调用表达的是不同维度的决策：

- `piMono()` / `openai()`：选择哪套 runtime 实现
- `sessionMode('file' | 'memory')`：是否走持久化会话
- `mode('agent' | 'chat')`：当前交互模式
- `lightweight(true | false)`：是否走轻量化路径

但现在这些维度往往在入口层被混在一条 builder 链里一次性写死，后果是：

1. 很难看出“哪部分是业务需求，哪部分是 runtime 假设”
2. 不同入口容易形成不同默认值
3. 恢复链路和正常发送链路容易逐渐分叉
4. 后面想切换默认 runtime 时，需要逐个入口清理

## 为什么这是不合理的

### 1. Route / RPC / IPC 层不应该拥有 runtime 选择权

这些入口层最适合表达的是“我要发一条消息”“我要恢复一个 thread”“我要跑轻量模式”。

它们不应该知道具体该 new 哪种 runtime builder，否则 runtime 选择规则就会散落在多个接入层中，后面很难统一演进。

### 2. Runtime 选择应该和模型选择一样，成为显式配置

当前模型已经有：

- Agent 默认模型
- Thread 级 overrideModel

但 runtime 还是隐式的、靠代码路径决定的。这会导致系统出现“模型是配置驱动，runtime 是源码驱动”的不一致状态。

### 3. 恢复链路不应该重新发明一套默认值

`ThreadWaker` 当前直接 `piMono()`，说明恢复时到底应该跑哪个 runtime，并没有从 thread/agent 配置中恢复出来，而是重新做了一次本地假设。

这类逻辑最容易造成：

- 正常发消息走 A runtime
- 恢复执行却走 B runtime
- 同一个 thread 前后行为不一致

### 4. “支持双 runtime” 目前更多是实现层能力，不是产品层能力

只要主入口仍然硬编码 `piMono()`，那么系统对外的真实行为就仍然是“单 runtime 默认实现”，而不是“真正可选择的双 runtime 系统”。

## 影响范围

### 受影响的能力

- Thread 消息发送主链路
- RPC 消息发送主链路
- IPC 提交执行链路
- Thread 恢复 / 唤醒链路
- Extension 内部 Agent 调用链路
- 后续新增 runtime 或切换默认 runtime 的改造成本

### 当前还未直接暴露的问题

- 目前如果系统几乎总是期望跑 PiMono，这个问题短期内可能不容易表现为 bug
- 但一旦开始正式支持“按 Agent/Thread 选择 runtime”，现有结构会立刻变成阻力

## 优先级
高

这不是一个“马上会炸”的线上 bug，但它是一个明确的架构债务，而且已经进入主执行链路。越晚收口，调用点只会越多，未来切换成本也会越高。

## 建议修复方向

### 方向 1：先把 runtime 选择提升为显式概念

建议后续在 Agent / Thread 领域模型中引入 runtime 相关字段，例如：

```typescript
type AgentRuntimeType = 'pimono' | 'openai';
```

以及类似下面的配置层级：

1. `Thread.overrideRuntime`
2. `Agent.runtime`
3. 全局默认 runtime

这样 runtime 选择才有稳定的落点，不再依赖调用方猜测。

### 方向 2：集中 Builder 组装，不让入口层直接挑 runtime

建议后续新增统一入口，例如：

```typescript
agentExecutor.createBuilder(...)
```

或者单独抽一个：

```typescript
RuntimeSelector / BuilderFactory
```

让 route / rpc / ipc / thread-recovery 只描述自己的业务意图：

- 当前是哪种调用来源
- 要不要持久化 session
- 是否 lightweight
- 是否 chat mode
- 当前 agent / thread 是谁

而不是自己写：

```typescript
agentExecutor.piMono().sessionMode('file')
```

### 方向 3：把 runtime 选择和执行语义拆开

后续 Builder 组装时，建议把以下几个维度分开处理：

1. runtime 类型
2. sessionMode
3. mode
4. lightweight
5. provider/model 覆盖

这样调用代码的含义会更清晰，也更方便统一默认值。

### 方向 4：恢复链路必须复用正常链路的选择逻辑

`ThreadWaker` 不应该再单独写一套 `piMono()` 默认值。

后续如果收敛 BuilderFactory，恢复链路应该直接复用和正常消息发送同一套 runtime 选择策略，避免 thread 前后执行环境不一致。

## 暂不建议现在直接做的事

在没有统一设计的前提下，不建议只把某一个入口从：

```typescript
agentExecutor.piMono()
```

改成：

```typescript
someCondition ? agentExecutor.openai() : agentExecutor.piMono()
```

这种改法只是把“硬编码单 runtime”升级成“硬编码分支逻辑”，本质问题仍然没有解决，甚至会让选择规则更加分散。

## 相关文件

- `src/main/agent/AgentExecutor.ts`
- `src/main/agent/agents/types.ts`
- `src/main/agent/threads/types.ts`
- `src/main/routes/ChatRoutes.ts`
- `src/main/rpc/ChatMethods.ts`
- `src/main/agent/threads/ThreadWaker.ts`
- `src/main/common/ipc/agentHandlers.ts`
- `src/main/agent/extension/ExtensionApi.ts`

## 后续修改时的验证建议

1. 验证同一个 Agent 在 HTTP / RPC / IPC / Thread 恢复路径下，runtime 选择结果一致
2. 验证 `Thread.overrideRuntime > Agent.runtime > 全局默认` 的优先级是否符合预期
3. 验证 `runtime` 和 `model` 是两个独立维度，不会互相覆盖语义
4. 验证 `sessionMode('file')` / `sessionMode('memory')` 在不同 runtime 下语义仍然清晰
5. 补充回归测试，覆盖：
   - 正常发送
   - 恢复执行
   - Extension 调用
   - 默认 runtime 回退
