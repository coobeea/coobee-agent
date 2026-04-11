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
   * Worker 脚本目录（只读，随应用打包分发）
   *
   * 包含 Python Worker 的源码、requirements.txt 和虚拟环境：
   *   workers/
   *   ├── tts/         TTS 语音合成
   *   │   ├── venv/    虚拟环境（gitignore）
   *   │   └── server.py
   *   ├── asr/         ASR 语音识别（FunASR）
   *   │   ├── venv/    虚拟环境（gitignore）
   *   │   └── server.py
   *   └── ...          未来新增的 Worker
   *
   * @example 开发: <项目>/workers | 生产: resources/workers
   */
  get scripts(): string {
    return is.dev ? path.join(app.getAppPath(), 'workers') : path.join(process.resourcesPath, 'workers');
  }

  /**
   * Worker 虚拟环境目录（已废弃）
   *
   * @deprecated 现在所有虚拟环境都在 Worker 目录内（workers/{name}/venv/）
   * @example workers/asr/venv/, workers/tts/venv/, workers/ocr/venv/
   */
  get envs(): string {
    return is.dev ? path.join(app.getAppPath(), 'worker-envs') : path.join(this.userHome, 'worker-envs');
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
    return process.env.VITE_MODEL_DIR || path.join(this.userHome, 'models');
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
