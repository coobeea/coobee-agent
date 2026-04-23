import { vi } from 'vitest';

vi.mock('electron', () => {
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

  const app = {
    isPackaged: false,
    getAppPath: vi.fn(() => process.cwd()),
    getPath: vi.fn((name: string) => appPaths[name] || '/tmp'),
    getName: vi.fn(() => 'coobee-agent-test'),
    getVersion: vi.fn(() => '0.0.0-test'),
    getLocale: vi.fn(() => 'en-US'),
    whenReady: vi.fn(async () => undefined),
    on: vi.fn(),
    off: vi.fn(),
    quit: vi.fn()
  };

  const BrowserWindow = Object.assign(vi.fn(), {
    fromId: vi.fn(() => null),
    getAllWindows: vi.fn(() => [])
  });

  class WebContentsView {
    webContents = {
      id: 1,
      isDestroyed: vi.fn(() => false),
      send: vi.fn()
    };
  }

  return {
    app,
    BrowserWindow,
    WebContentsView,
    webContents: {
      getAllWebContents: vi.fn(() => [])
    },
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn(),
      removeHandler: vi.fn(),
      removeListener: vi.fn()
    },
    dialog: {
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn(),
      showMessageBox: vi.fn()
    },
    clipboard: {
      readText: vi.fn(() => ''),
      writeText: vi.fn()
    },
    nativeImage: {
      createFromPath: vi.fn(() => ({}))
    },
    nativeTheme: {
      shouldUseDarkColors: false,
      on: vi.fn(),
      off: vi.fn()
    },
    globalShortcut: {
      register: vi.fn(),
      unregister: vi.fn(),
      unregisterAll: vi.fn()
    },
    Menu: {
      buildFromTemplate: vi.fn(() => ({})),
      setApplicationMenu: vi.fn()
    },
    Tray: vi.fn()
  };
});
