import path from 'path';

import { Env } from '@main/common/env';

/**
 * 共享网盘配置
 */
class SharedDriveConfig {
  private get userHome() {
    return Env.paths.userHome;
  }

  /**
   * 多智能体共享网盘
   *
   * 结构：
   *   shared-drive/
   *   ├── index.jsonl        全局索引
   *   ├── {agentId}/         按智能体分区
   *   │   └── {date}/{topic}/
   *   └── _shared/           公共区域
   *
   * @example 开发: <项目>/.home/shared-drive | 生产: ~/.coobee-agent/shared-drive
   */
  get root(): string {
    return path.join(this.userHome, 'shared-drive');
  }
}

export const SharedDrive = new SharedDriveConfig();
