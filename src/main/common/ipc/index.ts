/**
 * IPC 模块
 *
 * 统一注册 shell:, window:, tab: 相关 IPC 处理器
 */

import { registerShellHandlers } from './shellHandlers';
import { registerWindowHandlers } from './windowHandlers';
import { registerTabHandlers } from './tabHandlers';
import { registerOnboardingHandlers } from './onboardingHandlers';

export { ShellChannels, WindowChannels, TabChannels, EventChannels, OnboardingChannels } from '@shared/ipc';
export type { ShellChannel, WindowChannel, TabChannel, EventChannel, OnboardingChannel } from '@shared/ipc';
export { registerShellHandlers } from './shellHandlers';
export { registerWindowHandlers } from './windowHandlers';
export { registerTabHandlers } from './tabHandlers';
export { registerOnboardingHandlers } from './onboardingHandlers';

/**
 * 注册所有常用 IPC 处理器（shell + window + tab + onboarding）
 */
export function registerIpcHandlers(): void {
  registerShellHandlers();
  registerWindowHandlers();
  registerTabHandlers();
  registerOnboardingHandlers();
}
