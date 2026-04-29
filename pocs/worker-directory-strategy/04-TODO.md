# Worker 目录策略选型 - TODO

> 创建时间：2026-04-29
> 最近更新：2026-04-29

## 待办任务

### T1. 建立 `resources/workers` 作为内置 Worker 源码目录

- **目标**：将内置 Worker 源码归口到资源目录。
- **涉及范围**：
  - `resources/workers/`
  - `resources/workers/.gitignore`
  - `resources/workers/README.md`
- **验收标准**：
  - [x] `resources/workers/` 存在。
  - [x] 运行产物不会被 Git 跟踪。
  - [x] README 明确源码和运行产物边界。
- **状态**：[x]

### T2. 建立统一 Worker Runtime 路径

- **目标**：开发环境和生产环境使用同一套运行目录形状。
- **涉及范围**：
  - `src/main/config/workers.ts`
  - `src/main/common/worker/WorkerManager.ts`
  - `src/main/common/worker/types.ts`
- **验收标准**：
  - [x] 启动 Worker 不会创建 `resources/workers/{name}/venv`。
  - [x] venv 创建在 `{runtimeHome}/workers/{name}/venv`。
  - [x] data/cache/config 路径统一由配置层解析。
  - [x] 测试覆盖新路径。
- **状态**：[x]

### T3. 配置生产包复制 `resources/workers`

- **目标**：让生产态 Worker 源码位于 `process.resourcesPath/workers`。
- **涉及范围**：
  - `electron-builder.yml`
- **验收标准**：
  - [x] `extraResources` 从 `resources/workers` 复制到 `workers`。
  - [x] 排除 `venv`、`data`、`cache`、`logs`、`__pycache__`、`*.pyc`、`local_config.json`。
  - [x] `resources/workers/**` 不重复进入 app asar。
- **状态**：[x]

### T4. 迁移 `asr/tts/ocr`

- **目标**：迁移旧项目中三个需要的 Worker。
- **涉及范围**：
  - `/Users/lifeng/git/git_agents/coobee-ai/workers/{asr,tts,ocr}`
  - `resources/workers/{asr,tts,ocr}`
- **验收标准**：
  - [x] `asr/tts/ocr` 已有干净源码副本。
  - [x] 未复制 `venv`、`__pycache__`、`*.pyc`、`local_config.json`。
  - [x] `asr/tts/ocr` 默认不自动启动。
  - [x] JSON 和 Python 语法校验通过。
- **状态**：[x]

### T5. 后续用户运行副本设计

- **目标**：为后续用户配置覆盖和 Worker 升级做准备。
- **涉及范围**：
  - `src/main/common/worker`
  - `src/main/config/workers.ts`
  - `{runtimeHome}/workers/{name}/source`
- **验收标准**：
  - [ ] 有独立 POC 或设计文档。
  - [ ] 不阻塞当前内置 Worker 迁移。
- **状态**：[ ]
