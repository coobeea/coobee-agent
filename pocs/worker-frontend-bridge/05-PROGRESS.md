# Worker 前端对接方式 - PROGRESS

> 创建时间：2026-04-29

## 2026-04-29

- 已复盘旧项目 `/Users/lifeng/git/git_agents/coobee-ai` 的 Worker 对接方式。
- 已确认旧项目采用“Gateway 管理通道 + Worker 直连数据通道”。
- 已梳理当前 coobee-agent 已实现内容：
  - Worker RPC 管理接口。
  - Worker shared events。
  - 前端 worker store。
  - 状态栏 Worker 状态入口。
  - 设置页 Worker 管理入口。
- 已记录待讨论点：
  - 是否允许前端长期直连 Worker 端口。
  - 是否需要支持局域网 Web 访问 Worker。
  - 是否需要 Gateway 代理或 Worker token。
- 已补充 Gateway 代理模式讨论：
  - 当前 Gateway `/gateway/ws` 是 JSON RPC，不适合直接承载 ASR PCM。
  - 推荐新增 Gateway Worker 透明反向代理，而不是 JSON 多路复用。
  - 推荐调整为“Gateway 管理通道 + Gateway Worker Proxy 数据通道”。

## 当前状态

POC 文档已创建并补充 Gateway 代理模式，等待讨论后选择最终方案。
