# 会话删除 - TODO

> 创建时间：2026-04-29

## 1. 暴露 Thread 删除 API

- **目标**：提供 `/gateway/threads/:id` DELETE 路由。
- **涉及范围**：
  - `src/main/routes/ThreadRoutes.ts`
  - `src/shared/api/thread-types.ts`
- **具体动作**：
  - 校验 thread id。
  - 不存在返回 404。
  - `runStatus === "running"` 返回 409。
  - 成功调用 `ThreadStore.delete()` 并返回 `{ threadId, deleted: true }`。
- **验收标准**：
  - [x] DELETE API 已实现。
  - [x] 正在运行会话不会被删除。
- **状态**：[x]

## 2. 前端 Store 接入删除动作

- **目标**：让会话列表状态能响应删除 API。
- **涉及范围**：
  - `src/renderer/src/api/threads.ts`
  - `src/renderer/src/stores/threads.ts`
- **具体动作**：
  - API client 增加删除响应类型。
  - Store 增加 `deleteThread()` 和 `deletingThreadId`。
  - 删除成功后本地移除，并兼容后端事件再次通知。
- **验收标准**：
  - [x] 删除成功后列表立即移除。
  - [x] 删除失败时保留错误信息。
- **状态**：[x]

## 3. 会话列表增加删除交互

- **目标**：在侧边栏最近会话列表提供删除入口。
- **涉及范围**：
  - `src/renderer/src/components/thread/ThreadList.vue`
- **具体动作**：
  - hover 时展示删除按钮。
  - 第一次点击进入确认态，第二次确认删除。
  - 删除当前会话后跳转主页。
- **验收标准**：
  - [x] 会话列表可删除非运行会话。
  - [x] 当前会话被删除后不再停留在无效详情页。
- **状态**：[x]
