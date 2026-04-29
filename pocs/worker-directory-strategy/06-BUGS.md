# Worker 目录策略选型 - BUGS

> 创建时间：2026-04-29
> 最近更新：2026-04-29

## 已发现问题

### BUG-001: 旧 Worker 目录混入大量运行产物

- **现象**：旧 `workers/asr/tts/ocr` 目录体积达到数百 MB 到 1.1GB。
- **原因**：目录中存在就地 `venv`、Python 缓存和本地配置。
- **处理结果**：`asr/tts/ocr` 已按 Git 跟踪文件迁移到 `resources/workers`，未带入 `venv`、Python 缓存和本地配置。
- **状态**：已修复

### BUG-002: 就地 venv 会污染源码目录

- **现象**：旧机制和当前 WorkerManager 都倾向 `workers/{name}/venv`。
- **处理结果**：已在 `WorkersConfig` 中建立统一 runtime 路径，并让 `WorkerManager` 使用 `{runtimeHome}/workers/{name}/venv`。
- **状态**：已修复

### BUG-003: `local_config.json` 属于用户配置，不应迁入内置源码

- **现象**：旧 `asr/tts/ocr` 有 `local_config.json`，包含本机模型路径和模型名。
- **处理结果**：本轮迁移没有复制 `local_config.json`。
- **状态**：已规避

### BUG-004: Python 子进程不能依赖 asar 内脚本

- **现象**：Worker 是外部 Python 进程，生产态不能只依赖 app asar 内路径。
- **处理结果**：已在 `electron-builder.yml` 配置 `extraResources`，将 `resources/workers` 复制到 `process.resourcesPath/workers`。
- **状态**：已修复
