# 会话删除 - PROGRESS

> 创建时间：2026-04-29

## 2026-04-29

- 已新增 Thread 删除响应类型。
- 已实现 `/gateway/threads/:id` DELETE 路由。
- 已在前端 threads store 接入删除动作。
- 已在会话列表加入删除按钮和二次确认。
- 已验证 lint 通过。
- 已验证 `ThreadStore.enhanced.test.ts` 通过。

## 当前状态

第一版完成。删除范围为 Thread 记录，不清理工作区目录。
