/**
 * 配置管理中心
 *
 * 统一导出所有配置模块，方便业务代码引用。
 *
 * 设计理念：
 *   - 每个业务模块一个配置文件
 *   - 新增业务时只需添加新的配置文件，不影响现有模块
 *   - 保持 common/env.ts 的纯净性（只包含基础系统路径）
 *
 * 使用示例：
 *   import { Agents, Skills, Workers } from '@main/config';
 *
 *   const agentDir = Agents.builtin;
 *   const modelDir = Workers.models;
 *   const workspace = await Threads.getWorkspaceDir(threadId);
 */

export { Agents } from './agents';
export { Skills } from './skills';
export { Extensions } from './extensions';
export { Workers } from './workers';
export { Threads } from './threads';
export { Providers } from './providers';

// 向后兼容：保留 BusinessPaths 别名（逐步迁移后可移除）
import { Workers } from './workers';
export const BusinessPaths = {
  workers: {
    scripts: Workers.scripts,
    envs: Workers.envs,
    models: Workers.models
  },
  getAppRuntimeDir: Workers.getAppRuntimeDir.bind(Workers),
  getPlatformRuntimeDir: Workers.getPlatformRuntimeDir.bind(Workers)
};
