# Worker 子进程

Worker 是独立运行的子进程（Python / Node），提供后台能力（ASR / TTS / Embedding 等）。由 WorkerManager 统一管理，生命周期通过 Gateway RPC 暴露。

## 双层目录结构

Worker 是"只读脚本 + 可写运行产物"两层：

**脚本层（只读，随应用分发）**

```
resources/workers/
├── tts/
│   ├── worker.json          扫描入口（name/type/entry/port/enable/autoStart/...）
│   ├── server.py            入口脚本
│   └── requirements.txt     Python 依赖
├── asr/
│   └── ...
└── ...
```

生产环境下这层是打包在 app bundle 里的只读资源，不要尝试写入。

**运行产物层（可写）**

```
.home/workers/
└── {name}/
    ├── config.json          用户可写配置（覆盖脚本层 worker.json 的字段）
    ├── source/              用户源码副本（二阶段使用）
    ├── venv/                Python 虚拟环境
    ├── data/                Worker 数据
    └── cache/               Worker 缓存
```

模型共享仓库在 `.home/models/`（或由环境变量 `VITE_MODEL_DIR` 指向的路径）。

## 启动流程

WorkerManager 启动时：

一、扫描 `resources/workers/` 下所有含 `worker.json` 的子目录，读入配置。`enable: false` 的跳过。

二、对 `autoStart: true` 的 Worker，等端口可用、准备 venv、spawn 子进程、健康检查。

三、对 `worker.json` 进行 `fs.watch` 监控，文件变化触发防抖重载（500ms）。

开发态下你可以直接编辑项目下 `resources/workers/{name}/worker.json`，生效。生产态该目录在 app bundle 里只读，只能通过 RPC 接口或前端设置去改。

## 给 Agent 的控制入口

**不要直接改 worker.json 或 config.json。** 控制 worker 走 Gateway RPC：

- `worker.start`（参数 `{ name }`）— 启动某个 worker（异步，不阻塞）
- `worker.stop`（参数 `{ name }`）— 停止
- `worker.list` — 列出已注册的所有 worker 与状态
- `worker.status`（参数 `{ name }`）— 查某个 worker 的当前状态

状态推送由前端订阅 `worker:status` / `worker:progress` / `worker:error` 事件。

Agent 自身目前没有"启停 worker"的 builtin 工具。如果业务确实需要，你能做的选择是：

一、告知用户通过应用设置里的 Worker 面板操作。

二、如果上层把 `worker.start` / `worker.stop` 封成了 Extension 注册的工具，通过 `<runtime_environment>` 的 `extensions` 列表判断是否可用，再调用。

三、只读查询 `.home/workers/{name}/config.json` 了解当前配置是合法的。

## 配置关键字段

`worker.json` / `config.json` 典型字段：

- `name` — Worker 名称（默认等于目录名）
- `type` — `python` / `native`
- `entry` — 入口脚本
- `port` — 监听端口
- `enable` — 是否启用（默认 true，显式 false 时跳过启动）
- `autoStart` — 应用启动时是否自动运行
- `autoRestart` — 崩溃后自动重启
- `maxRestarts` — 最大重启次数
- `healthCheckPath` / `healthCheckTimeout` — 健康检查
- `modelDir` — 覆盖默认模型目录
- `env` — 额外环境变量

## 事实修正

老文档建议"读 worker.json → 改 enable → 写回"的做法在当前实现下是错的：真实监听的 `worker.json` 在打包后只读的 `resources/workers/` 里，写不进去；`.home/workers/{name}/` 下是 `config.json` 而不是 `worker.json`。正确的控制手段是调 `worker.start` / `worker.stop` RPC。

## 注意事项

一、Worker 是系统级组件，生命周期由 WorkerManager 独占，不要 spawn 自己的 Python 子进程去复刻它。

二、改 `.home/workers/{name}/config.json` 只会影响下次启动时的用户配置层，即时生效需要配合 `worker.stop` + `worker.start`。

三、Worker 端口冲突会导致启动失败。查询 `worker.list` 可以看到已分配端口，避免自造冲突。
