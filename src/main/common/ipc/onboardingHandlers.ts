/**
 * Onboarding IPC Handlers
 *
 * 处理用户首次引导相关的 IPC 请求
 */

import { ipcMain } from 'electron';
import ElectronStore from 'electron-store';
import { OnboardingChannels } from '@shared/ipc/channels';

// 存储 key
const ONBOARDING_KEY = 'app.onboardingCompleted';

// 使用单独的 store 实例管理引导状态
const store = new ElectronStore({ name: 'onboarding' });

/**
 * 注册 Onboarding 相关的 IPC 处理器
 */
export function registerOnboardingHandlers(): void {
  /**
   * 检查是否完成引导
   * @returns {boolean} 是否已完成引导
   */
  ipcMain.handle(OnboardingChannels.CHECK, (): boolean => {
    return store.get(ONBOARDING_KEY, false) as boolean;
  });

  /**
   * 标记引导完成
   * @returns {boolean} 操作是否成功
   */
  ipcMain.handle(OnboardingChannels.COMPLETE, (): boolean => {
    store.set(ONBOARDING_KEY, true);
    return true;
  });

  /**
   * 重置引导状态（用于"重新运行引导"功能）
   * @returns {boolean} 操作是否成功
   */
  ipcMain.handle(OnboardingChannels.RESET, (): boolean => {
    store.set(ONBOARDING_KEY, false);
    return true;
  });
}
