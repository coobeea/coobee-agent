# 记忆系统（Memory）

Memory 让你把知识、经验、用户偏好在会话结束后保留下来，下次还能用。

## 两级记忆

记忆分两层，底层文件就是 markdown：

- **Agent 级（永久）** — 落在 `{agent_home}/memory/`（即 `.home/agents/{agentId}/memory/`）。跨所有会话保留，是这个 Agent 的长期知识库。通常由 memory-agent 扩展在会话结束时自动整理入库，你也可以直接读写。
- **Session 级（随会话）** — 落在 `{workspace}/memory/`（即 `agent_home/workspace/memory/`）。由 memory-thread 扩展在对话过程中自动写入，记录本次会话的临时笔记。

没有"用户级记忆"这一层。如果想记录全局用户偏好，写到 Agent 级即可（或者写到 `{agent_home}/USER.md`，它也会被注入 system prompt）。

## memory 工具

调用方式统一通过 `memory` 工具。支持的 action 只有四个：

- `list` — 列出某 scope 下的记忆文件
- `get` — 读取指定记忆文件内容
- `search` — 多关键字评分搜索，返回片段
- `write` — 写入/更新记忆文件（**仅对 session 级生效**）

不存在 `read` / `append` / `delete` 这些 action——别调。

scope 字段有三种取值：

- `'agent'` — 只操作 Agent 级
- `'session'` — 只操作 Session 级
- 不传 — `list` / `search` 两层都搜；`write` 默认写 session 级

## 典型用法

记用户偏好到 Agent 级（长期）：

```
memory({
  action: 'write',
  scope: 'session',     // 注：write 只能写 session 级
  file: 'preferences.md',
  content: '# 偏好\n- 编程语言: TypeScript 优先'
});
```

如果需要**持久化到 Agent 级**，写到 session 级后依靠 memory-agent 扩展在会话结束时归档；或直接用文件工具写 `{agent_home}/memory/preferences.md`。

跨会话搜索知识：

```
memory({
  action: 'search',
  scope: 'agent',
  query: '数据库连接池'
});
```

列出当前会话所有记忆文件：

```
memory({
  action: 'list',
  scope: 'session'
});
```

读取指定文件：

```
memory({
  action: 'get',
  scope: 'agent',
  file: 'MEMORY.md'
});
```

## 文件命名建议

Agent 级建议几个约定文件名：`MEMORY.md`（核心知识）、`lessons.md`（失败教训与最佳实践）、`preferences.md`（用户偏好）、`domain.md`（领域知识）。

Session 级随便你起名，系统不强制。memory-thread 扩展会按自己的命名规则写，不要冲突。

## 注意事项

一、记忆是 markdown，不是数据库。写清楚标题和层级。

二、记忆积累会越滚越大。长期运行的 Agent 要定期让 memory-agent 扩展压缩旧记忆，或主动删除过时内容。

三、敏感信息（API Key、密钥、用户隐私）不要写进记忆，走 `config/secrets.json5`。
