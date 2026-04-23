import { vi } from 'vitest';

const appPaths: Record<string, string> = {
  home: process.env.HOME || '/tmp',
  temp: '/tmp',
  userData: '/tmp/coobee-agent-userData',
  appData: '/tmp',
  downloads: '/tmp/Downloads',
  documents: '/tmp/Documents',
  desktop: '/tmp/Desktop',
  exe: process.execPath
};

export const app = {
  isPackaged: false,
  getAppPath: vi.fn(() => process.cwd()),
  getPath: vi.fn((name: string) => appPaths[name] || '/tmp'),
  getName: vi.fn(() => 'coobee-agent-test'),
  getVersion: vi.fn(() => '0.0.0-test'),
  getLocale: vi.fn(() => 'en-US'),
  whenReady: vi.fn(async () => undefined),
  on: vi.fn(),
  off: vi.fn(),
  quit: vi.fn(),
  relaunch: vi.fn(),
  exit: vi.fn()
};

export const BrowserWindow = Object.assign(vi.fn(), {
  fromId: vi.fn(() => null),
  getAllWindows: vi.fn(() => [])
});

export class WebContentsView {
  webContents = {
    id: 1,
    isDestroyed: vi.fn(() => false),
    send: vi.fn()
  };
}

export const webContents = {
  getAllWebContents: vi.fn(() => [])
};

export const ipcMain = {
  handle: vi.fn(),
  on: vi.fn(),
  removeHandler: vi.fn(),
  removeListener: vi.fn()
};

export const dialog = {
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  showMessageBox: vi.fn()
};

export const clipboard = {
  readText: vi.fn(() => ''),
  writeText: vi.fn()
};

export const nativeImage = {
  createFromPath: vi.fn(() => ({}))
};

export const nativeTheme = {
  shouldUseDarkColors: false,
  on: vi.fn(),
  off: vi.fn()
};

export const globalShortcut = {
  register: vi.fn(),
  unregister: vi.fn(),
  unregisterAll: vi.fn()
};

export const Menu = {
  buildFromTemplate: vi.fn(() => ({})),
  setApplicationMenu: vi.fn()
};

export const Tray = vi.fn();

export const session = {
  defaultSession: {
    webRequest: {
      onHeadersReceived: vi.fn()
    }
  }
};

export default {
  app,
  BrowserWindow,
  WebContentsView,
  webContents,
  ipcMain,
  dialog,
  clipboard,
  nativeImage,
  nativeTheme,
  globalShortcut,
  Menu,
  Tray,
  session
};
