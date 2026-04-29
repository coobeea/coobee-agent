# Worker 目录策略选型 - PROGRESS

> 创建时间：2026-04-29
> 最近更新：2026-04-29

## 进度记录

| 日期       | 内容                                                             | 状态      |
| ---------- | ---------------------------------------------------------------- | --------- |
| 2026-04-29 | 分析旧项目 `/Users/lifeng/git/git_agents/coobee-ai/workers` 结构 | ✅ 完成   |
| 2026-04-29 | 确认旧目录是“源码 + 运行产物”混合工作区                          | ✅ 完成   |
| 2026-04-29 | 确认最终目录：`resources/workers` + 统一 Worker Runtime          | ✅ 完成   |
| 2026-04-29 | T1: 建立 `resources/workers` 作为内置 Worker 源码目录            | ✅ 完成   |
| 2026-04-29 | T2: 建立统一 Worker Runtime 路径                                 | ✅ 完成   |
| 2026-04-29 | T3: 配置生产包复制 `resources/workers`                           | ✅ 完成   |
| 2026-04-29 | T4: 迁移 `asr/tts/ocr`                                           | ✅ 完成   |
| -          | T5: 后续用户运行副本设计                                         | ⬜ 待实施 |

## 当前结论

```text
resources/workers/{name}             # 开发态内置源码，Git 跟踪
process.resourcesPath/workers/{name} # 生产态内置模板，打包复制
{runtimeHome}/workers/{name}/venv    # Python venv
{runtimeHome}/workers/{name}/data    # Worker 专属数据
{runtimeHome}/workers/{name}/cache   # Worker 专属缓存
{runtimeHome}/models                 # 共享模型缓存
```

## 本轮实施记录

### 2026-04-29: Runtime 路径迁移

- 在 `src/main/config/workers.ts` 增加 `runtimeHome`、`runtimeWorkers`、`getRuntimeDir`、`getVenvDir`、`getDataDir`、`getCacheDir`、`getConfigPath`。
- 将 `WorkerManager.getVenvDir()` 从源码目录迁移到 `{runtimeHome}/workers/{name}/venv`。
- Worker 子进程新增 `WORKER_RUNTIME_DIR`、`WORKER_DATA_DIR`、`WORKER_CACHE_DIR`、`WORKER_CONFIG_PATH` 环境变量。
- Python Worker 的 `modelDir` 现在按 `worker.json modelDir` 优先，否则使用 `Workers.models`。
- 增加测试，验证运行产物目录不会落到源码目录。
- 同步更新 `resources/skills/worker-creator/SKILL.md`，避免后续新 Worker 继续使用就地 venv。

### 2026-04-29: 迁移 asr/tts/ocr

- 从 `/Users/lifeng/git/git_agents/coobee-ai/workers` 迁移 Git 跟踪源码到 `resources/workers/{asr,tts,ocr}`。
- 未迁移 `venv/`、`__pycache__/`、`*.pyc`、`local_config.json`。
- 新增 `resources/workers/.gitignore` 和 `resources/workers/README.md`。
- 将 `asr` 的 `autoStart` 从 `true` 改为 `false`，保持重型 Worker 不随应用默认启动。

### 2026-04-29: 源码目录改入 resources

- 将临时创建的根目录 `workers/` 移到 `resources/workers/`。
- 将开发态 Worker 扫描路径改为 `<项目>/resources/workers`。
- 配置 `electron-builder.yml`，生产包将 `resources/workers` 复制到 `process.resourcesPath/workers`。
