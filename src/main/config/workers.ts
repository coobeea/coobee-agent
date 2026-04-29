import { is } from '@electron-toolkit/utils';
import { app } from 'electron';
import path from 'path';

import { Env } from '@main/common/env';

/**
 * Worker 与模型相关配置
 */
class WorkersConfig {
  private get userHome() {
    return Env.paths.userHome;
  }

  /**
   * Worker 运行根目录（可写）
   *
   * 所有 Worker 运行产物都从这里派生，开发态和生产态保持相同目录形状。
   *
   * 优先级：
   *   1. WORKER_RUNTIME_HOME / VITE_WORKER_RUNTIME_HOME 环境变量
   *   2. Env.paths.userHome
   *
   * @example 开发: <项目>/.home | 生产: ~/.coobee-agent
   */
  get runtimeHome(): string {
    return process.env.WORKER_RUNTIME_HOME || process.env.VITE_WORKER_RUNTIME_HOME || this.userHome;
  }

  /**
   * Worker 脚本目录（只读，随应用打包分发）
   *
   * 包含 Python Worker 的源码、requirements.txt 和 worker.json：
   *   workers/
   *   ├── tts/         TTS 语音合成
   *   │   ├── worker.json
   *   │   └── server.py
   *   ├── asr/         ASR 语音识别（FunASR）
   *   │   ├── worker.json
   *   │   └── server.py
   *   └── ...          未来新增的 Worker
   *
   * @example 开发: <项目>/resources/workers | 生产: resources/workers
   */
  get scripts(): string {
    return is.dev ? path.join(app.getAppPath(), 'resources', 'workers') : path.join(process.resourcesPath, 'workers');
  }

  /**
   * Worker 运行目录根（可写）
   *
   * @example <runtimeHome>/workers
   */
  get runtimeWorkers(): string {
    return path.join(this.runtimeHome, 'workers');
  }

  /**
   * 模型仓库目录（可写，所有 Worker 共享）
   *
   * 优先级：
   *   1. VITE_MODEL_DIR 环境变量（.env 配置，最高优先）
   *   2. 默认路径 ~/.coobee-agent/models
   *
   * 模型按来源自动分级存放：
   *   models/
   *   ├── Qwen/                    TTS 模型
   *   ├── FunAudioLLM/             ASR 模型
   *   └── hub/                     HuggingFace hub 缓存
   */
  get models(): string {
    return process.env.VITE_MODEL_DIR || path.join(this.runtimeHome, 'models');
  }

  /**
   * 获取 Worker 源码目录（只读）
   */
  getScriptDir(name: string): string {
    return path.join(this.scripts, name);
  }

  /**
   * 获取 Worker 运行目录（可写）
   */
  getRuntimeDir(name: string): string {
    return path.join(this.runtimeWorkers, name);
  }

  /**
   * 获取 Worker 用户源码副本目录（第二阶段使用）
   */
  getRuntimeSourceDir(name: string): string {
    return path.join(this.getRuntimeDir(name), 'source');
  }

  /**
   * 获取 Worker Python 虚拟环境目录
   */
  getVenvDir(name: string): string {
    return path.join(this.getRuntimeDir(name), 'venv');
  }

  /**
   * 获取 Worker 专属数据目录
   */
  getDataDir(name: string): string {
    return path.join(this.getRuntimeDir(name), 'data');
  }

  /**
   * 获取 Worker 专属缓存目录
   */
  getCacheDir(name: string): string {
    return path.join(this.getRuntimeDir(name), 'cache');
  }

  /**
   * 获取 Worker 用户配置文件路径
   */
  getConfigPath(name: string): string {
    return path.join(this.getRuntimeDir(name), 'config.json');
  }

  /**
   * 获取应用运行时目录（runtime/）
   * 用于存储跨平台的二进制文件
   *
   * @returns 运行时目录路径
   * @example
   * - 开发模式: /path/to/coobee-agent/runtime
   * - 生产模式: /Applications/coobee-agent.app/Contents/Resources/runtime
   */
  getAppRuntimeDir(): string {
    // 支持环境变量覆盖（用于测试）
    if (process.env.APP_RUNTIME_DIR) {
      return process.env.APP_RUNTIME_DIR;
    }

    if (Env.isDev) {
      // 开发模式：项目根目录/runtime
      return path.join(process.cwd(), 'runtime');
    }

    // 生产模式：resourcesPath/runtime
    return path.join(process.resourcesPath, 'runtime');
  }

  /**
   * 获取当前平台的运行时目录
   *
   * @returns 平台特定的运行时目录路径
   * @example
   * - macOS: /path/to/runtime/macos
   * - Windows: /path/to/runtime/win
   * - Linux: /path/to/runtime/linux
   */
  getPlatformRuntimeDir(): string {
    const runtimeDir = this.getAppRuntimeDir();
    const platformDir = Env.isWindows ? 'win' : Env.isMac ? 'macos' : 'linux';

    return path.join(runtimeDir, platformDir);
  }
}

export const Workers = new WorkersConfig();
