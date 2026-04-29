# Built-in Workers

This directory contains built-in Worker source packages.

Keep this directory clean and reviewable:

- Commit source files such as `worker.json`, `server.py`, `requirements.txt`, `models.json`, docs, and tests.
- Do not commit runtime artifacts such as `venv/`, `data/`, `cache/`, logs, `local_config.json`, Python cache files, or downloaded model files.
- Worker runtime data is resolved by the main process configuration and written under `{runtimeHome}/workers/{name}`.
- Shared model cache is resolved by configuration and written under `{runtimeHome}/models`.

In production builds, these built-in Worker sources should be copied to `process.resourcesPath/workers`.
