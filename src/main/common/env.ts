import { is } from '@electron-toolkit/utils';
import { app } from 'electron';
import fs from 'fs';
import { mkdirp } from 'mkdirp';
import path from 'path';

/**
 * Lazy-evaluated environment configuration
 *
 * All properties that access 'app' object are wrapped in getters
 * to avoid premature access during module initialization
 */
class EnvClass {
  get isDev(): boolean {
    return is.dev;
  }

  get isProd(): boolean {
    return !is.dev;
  }

  get isTest(): boolean {
    return process.env.NODE_ENV === 'test';
  }

  get isWindows(): boolean {
    return process.platform === 'win32';
  }

  get isMac(): boolean {
    return process.platform === 'darwin';
  }

  get isLinux(): boolean {
    return process.platform === 'linux';
  }

  get isPackaged(): boolean {
    return app.isPackaged;
  }

  // 主进程环境变量
  get main(): {
    bundleId: string | undefined;
    logLevel: string | undefined;
    logMaxSize: string | undefined;
    debug: string | undefined;
    openDevTools: string | undefined;
    serverPort: string | undefined;
    serverHost: string;
    workerHost: string;
    modelDir: string | undefined;
  } {
    return {
      bundleId: process.env.VITE_MAIN_BUNDLE_ID,
      logLevel: process.env.VITE_LOG_LEVEL,
      logMaxSize: process.env.VITE_LOG_MAX_SIZE,
      debug: process.env.VITE_DEBUG,
      openDevTools: process.env.VITE_OPEN_DEVTOOLS,
      /** 统一服务端口（HTTP + WebSocket 共享），默认 8765 */
      serverPort: process.env.VITE_SERVER_PORT,
      /** 服务绑定地址，默认 127.0.0.1（设为 0.0.0.0 可开启局域网访问） */
      serverHost: process.env.VITE_SERVER_HOST || '127.0.0.1',
      /** Worker 服务绑定地址，默认仅本机访问；代理模式下通常不需要暴露到局域网 */
      workerHost: process.env.VITE_WORKER_HOST || process.env.WORKER_HOST || '127.0.0.1',
      /** 模型存储目录（环境变量优先，未设置则用默认路径） */
      modelDir: process.env.VITE_MODEL_DIR
    };
  }

  get app(): {
    name: string;
    version: string;
    locale: string;
  } {
    return {
      name: app.getName(),
      version: app.getVersion(),
      locale: app.getLocale()
    };
  }

  private _paths?: ReturnType<typeof this._computePaths>;

  get paths(): ReturnType<typeof this._computePaths> {
    if (!this._paths) {
      this._paths = this._computePaths();
    }
    return this._paths;
  }

  private _computePaths(): {
    root: string;
    userData: string;
    appData: string;
    logPath: string;
    installDir: string;
    userHome: string;
    configDir: string;
    secretsDir: string;
    home: string;
    temp: string;
    downloads: string;
    documents: string;
    desktop: string;
    builtinSkillsDir: string;
    userSkillsDir: string;
    builtinExtensionsDir: string;
    userExtensionsDir: string;
    builtinAgentsDir: string;
    agentsMdPath: string;
    threadsDir: string;
    userAgentsDir: string;
  } {
    // === 基础路径计算 ===
    const _userHome = is.dev
      ? path.join(app.getAppPath(), '.home')
      : path.join(app.getPath('home'), '.' + app.getName());

    return {
      // === 应用路径（Application Paths）===
      /** 应用根目录 (如: /Applications/coobee-ai.app/Contents/Resources/app.asar) */
      root: app.getAppPath(),
      /** 应用数据目录 - 存储数据库、配置等 (如: ~/Library/Application Support/coobee-ai) */
      userData: app.getPath('userData'),
      /** 应用数据目录(系统级) (如: ~/Library/Application Support) */
      appData: app.getPath('appData'),
      /** 日志目录 (如: /path/to/app) */
      logPath: !is.dev && app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath(),
      /** 安装目录 (如: /Applications/coobee-ai.app/Contents/MacOS) */
      installDir: !is.dev && app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath(),
      /** 用户主目录 (开发: <项目>/.home | 生产: ~/.coobee-ai) */
      userHome: _userHome,

      // === 配置目录（Config）===
      /** 用户配置目录 @example 开发: <项目>/.home/config | 生产: ~/.coobee-ai/config */
      configDir: path.join(_userHome, 'config'),

      // === 敏感信息目录（Secrets）===
      /** 敏感信息目录（统一存放在 config 目录下） @example 开发: <项目>/.home/config | 生产: ~/.coobee-ai/config */
      secretsDir: path.join(_userHome, 'config'),

      // === Agent Paths ===
      builtinSkillsDir: path.join(app.getAppPath(), 'resources', 'skills'),
      userSkillsDir: path.join(_userHome, 'skills'),
      builtinExtensionsDir: path.join(app.getAppPath(), 'resources', 'extensions'),
      userExtensionsDir: path.join(_userHome, 'extensions'),
      builtinAgentsDir: path.join(app.getAppPath(), 'resources', 'agents'),
      agentsMdPath: path.join(_userHome, 'agents.md'),
      threadsDir: path.join(_userHome, 'threads'),
      userAgentsDir: path.join(_userHome, 'agents'),

      // === 系统路径（System Paths）===
      /** 系统用户目录 (如: /Users/username) */
      home: app.getPath('home'),
      /** 系统临时目录 (如: /var/folders/xxx) */
      temp: app.getPath('temp'),
      /** 系统下载目录 (如: ~/Downloads) */
      downloads: app.getPath('downloads'),
      /** 系统文档目录 (如: ~/Documents) */
      documents: app.getPath('documents'),
      /** 系统桌面目录 (如: ~/Desktop) */
      desktop: app.getPath('desktop')
    };
  }

  isRendererProcess(): boolean {
    return typeof process === 'undefined' || !process || process.type === 'renderer';
  }

  isMainProcess(): boolean {
    return typeof process !== 'undefined' && process.type === 'browser';
  }

  isForkedChildProcess(): boolean {
    return Number(process.env.ELECTRON_RUN_AS_NODE) === 1;
  }

  getResourcePath(relativePath: string): string {
    return path.join(this.isDev ? process.cwd() : process.resourcesPath, relativePath);
  }

  async getInstallDir(): Promise<string> {
    const installDir = this.paths.installDir;
    if (!fs.existsSync(installDir)) {
      await mkdirp(installDir);
    }
    return installDir;
  }

  async getUpgradeDir(): Promise<string> {
    const installDir = await this.getInstallDir();
    const upgradeDir = path.join(installDir, 'upgrade');
    if (!fs.existsSync(upgradeDir)) {
      await mkdirp(upgradeDir);
    }
    return upgradeDir;
  }

  async getAgentWorkspaceDir(_sessionId: string): Promise<string> {
    throw new Error('[Env] getAgentWorkspaceDir is deprecated. Use AgentRuntimeLayout for Agent workspaces.');
  }

  async getAgentHomeDir(agentId: string): Promise<string> {
    const dir = path.join(this.paths.userAgentsDir, agentId);
    if (!fs.existsSync(dir)) {
      await mkdirp(dir);
    }
    return dir;
  }

  async getSkillSearchPaths(workspace?: string, agentHome?: string): Promise<string[]> {
    const { SkillManager } = await import('@main/agent/skills/SkillManager');
    const sources = await SkillManager.buildDefaultSearchPathSources({ workspace, agentHome });
    return SkillManager.searchPathsFromSources(sources);
  }

  getExtensionSearchPaths(_workspace?: string): string[] {
    return [this.paths.userExtensionsDir, this.paths.builtinExtensionsDir];
  }
}

export const Env = new EnvClass();
export default Env;
