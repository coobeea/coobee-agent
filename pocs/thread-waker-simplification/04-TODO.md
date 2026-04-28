# ThreadWaker 过度设计简化 - 待办事项

> 创建时间：2026-04-28
> 关联分支：待创建

## 状态说明

- [ ] 待处理
- [x] 已完成
- [-] 已取消

---

## 待办事项

### 1. 重写 ThreadWaker.ts 为纯函数

- **描述**：将 `ThreadWaker` 类替换为 `recoverPendingThreads()` 纯函数
- **验收标准**：
  - [x] 删除 `ThreadWakeEvent` 接口
  - [x] 删除 `ThreadWaker` 类（单例、start/stop、EventBus 监听）
  - [x] 删除 EventBus 导入
  - [x] 导出 `recoverPendingThreads()` 函数
  - [x] 函数内部：一次 ThreadStore 查询 + 逐个 submit
  - [x] 不手动更新 runStatus
  - [-] `pnpm typecheck` 通过（仓库现有 runtime 测试/CompressionService 类型问题阻塞，非本项新增）
- **状态**：[x] 已完成

---

### 2. 重写测试文件

- **描述**：重写 `ThreadWaker.integration.test.ts`，适配新的函数式接口
- **验收标准**：
  - [x] 去掉 EventBus mock
  - [x] 去掉私有方法访问（`as unknown as PrivateThreadWaker`）
  - [x] 测试场景 1：无 pending threads → 不调 submit
  - [x] 测试场景 2：有 running threads → submit 成功
  - [x] 测试场景 3：submit 返回 busy → 记录 warn 日志
  - [x] 测试场景 4：submit 抛出异常 → 不崩溃，其他 thread 继续
  - [x] 测试场景 5：ThreadStore.listAsync 失败 → 记录 error 日志
- **状态**：[x] 已完成

---

### 3. 接入生产启动流程

- **描述**：在应用 bootstrap 中调用 `recoverPendingThreads()`
- **验收标准**：
  - [x] 找到启动入口文件
  - [x] 在 Agent 系统就绪后添加 `await recoverPendingThreads()` 调用
  - [x] 不阻塞启动流程（函数内部有 try-catch）
  - [x] 日志确认恢复逻辑在生产环境执行
- **状态**：[x] 已完成

---

### 4. 全量验证

- **描述**：确保修改不影响现有功能
- **验收标准**：
  - [-] `pnpm typecheck` 通过（仓库现有问题阻塞，非本项新增）
  - [x] 本次相关文件 ESLint 通过
  - [x] 相关测试通过（含更新后的 ThreadWaker 测试）
  - [x] 检查是否还有其他文件引用旧的 `ThreadWaker` 类或 `ThreadWakeEvent` 接口
- **状态**：[x] 已完成

---

### 5. 清理与收尾

- **描述**：确认无遗留引用，提交代码
- **验收标准**：
  - [x] 全局搜索确认无遗漏的旧引用
  - [x] Git diff 确认只修改了必要的文件
  - [-] Commit message 描述清晰（本轮未提交）
- **状态**：[x] 已完成

---

## 执行顺序

1. **先重写 ThreadWaker.ts**（任务 1）：核心改动
2. **再重写测试**（任务 2）：验证改动正确
3. **接入启动流程**（任务 3）：让恢复逻辑生效
4. **全量验证**（任务 4）：确保无回归
5. **收尾**（任务 5）：提交

---

## 改动文件预估

| 文件                                                               | 改动类型 | 预计行数变化 |
| ------------------------------------------------------------------ | -------- | ------------ |
| `src/main/agent/threads/ThreadWaker.ts`                            | 重写     | 212 → ~55    |
| `src/main/agent/threads/__tests__/ThreadWaker.integration.test.ts` | 重写     | 117 → ~100   |
| 启动入口                                                           | 新增1行  | +1           |
