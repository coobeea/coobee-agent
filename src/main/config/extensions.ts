import { is } from '@electron-toolkit/utils';
import { app } from 'electron';
import fs from 'fs';
import { mkdirp } from 'mkdirp';
import path from 'path';

import { Env } from '@main/common/env';

/**
 * Extension 相关配置
 */
class ExtensionsConfig {
  private get userHome() {
    return Env.paths.userHome;
  }

  /**
   * 内置 Extension 目录（只读，随应用分发）
   *
   * @example 开发: <项目>/extensions | 生产: resources/extensions
   */
  get builtin(): string {
    return is.dev ? path.join(app.getAppPath(), 'extensions') : path.join(process.resourcesPath, 'extensions');
  }

  /**
   * 用户 Extension 目录（可读写，用户自行安装/编写）
   *
   * Extension 多级合并优先级（后者覆盖前者同 ID）：
   *   1. builtin                — 内置（最低）
   *   2. user                   — 用户级
   *   3. {workspace}/extensions — 工作空间级（最高，仅当前 Agent 可见）
   *
   * @example 开发: <项目>/.home/extensions | 生产: ~/.coobee-agent/extensions
   */
  get user(): string {
    return path.join(this.userHome, 'extensions');
  }

  /**
   * 获取 Extension 搜索路径列表（按优先级从低到高）
   *
   * 与 Skill 同构的三级目录：
   *   1. builtin                — 内置（最低优先级）
   *   2. user                   — 用户级
   *   3. {workspace}/extensions — 工作空间级（最高优先级）
   *
   * @param workspace 当前工作空间路径（可选）
   */
  async getSearchPaths(workspace?: string): Promise<string[]> {
    const extensionPaths = [this.builtin, this.user];
    if (workspace) {
      extensionPaths.push(path.join(workspace, 'extensions'));
    }
    for (const dir of extensionPaths) {
      if (!fs.existsSync(dir)) {
        await mkdirp(dir);
      }
    }
    return extensionPaths;
  }
}

export const Extensions = new ExtensionsConfig();
