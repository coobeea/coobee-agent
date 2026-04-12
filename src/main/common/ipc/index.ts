/**
 * IPC 模块
 *
 * 统一注册 shell:, window:, tab: 相关 IPC 处理器
 */

import { registerShellHandlers } from './shellHandlers';
import { registerWindowHandlers } from './windowHandlers';
import { registerTabHandlers } from './tabHandlers';
import { registerAgentHandlers } from './agentHandlers';

export { ShellChannels, WindowChannels, TabChannels, EventChannels } from '@shared/ipc';
export type { ShellChannel, WindowChannel, TabChannel, EventChannel } from '@shared/ipc';
export { registerShellHandlers } from './shellHandlers';
export { registerWindowHandlers } from './windowHandlers';
export { registerTabHandlers } from './tabHandlers';
export { registerAgentHandlers } from './agentHandlers';

/**
 * 注册所有常用 IPC 处理器（shell + window + tab + agent）
 */
export function registerIpcHandlers(): void {
  registerShellHandlers();
  registerWindowHandlers();
  registerTabHandlers();
  registerAgentHandlers();
}
