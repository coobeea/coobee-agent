import { vi } from 'vitest';

export const is = {
  dev: true
};

export const platform = {
  isWindows: process.platform === 'win32',
  isMacOS: process.platform === 'darwin',
  isLinux: process.platform === 'linux'
};

export const electronApp = {
  setAppUserModelId: vi.fn(),
  setAutoLaunch: vi.fn(() => true),
  skipProxy: vi.fn(async () => undefined)
};

export const optimizer = {
  watchWindowShortcuts: vi.fn(),
  registerFramelessWindowIpc: vi.fn()
};
