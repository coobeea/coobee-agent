import { describe, it, expect } from 'vitest';
import { resolveWindowsCommandShim } from '../windows-command';

const NPM_LIKE = ['npm', 'pnpm', 'yarn', 'npx'] as const;

describe('resolveWindowsCommandShim', () => {
  describe('非 Windows 平台', () => {
    it.each(['linux', 'darwin', 'freebsd'] as NodeJS.Platform[])('platform=%s 原样返回', (platform) => {
      for (const cmd of NPM_LIKE) {
        expect(resolveWindowsCommandShim({ command: cmd, cmdCommands: NPM_LIKE, platform })).toBe(cmd);
      }
      // 就算带绝对路径也不改
      expect(resolveWindowsCommandShim({ command: '/usr/local/bin/npm', cmdCommands: NPM_LIKE, platform })).toBe(
        '/usr/local/bin/npm'
      );
    });
  });

  describe('Windows 平台', () => {
    const win: NodeJS.Platform = 'win32';

    it('npm / pnpm / yarn / npx 会被补上 .cmd', () => {
      for (const cmd of NPM_LIKE) {
        expect(resolveWindowsCommandShim({ command: cmd, cmdCommands: NPM_LIKE, platform: win })).toBe(`${cmd}.cmd`);
      }
    });

    it('已带扩展名不重复拼接', () => {
      expect(resolveWindowsCommandShim({ command: 'npm.cmd', cmdCommands: NPM_LIKE, platform: win })).toBe('npm.cmd');
      expect(resolveWindowsCommandShim({ command: 'npm.exe', cmdCommands: NPM_LIKE, platform: win })).toBe('npm.exe');
    });

    it('大小写归一：NPM 等价 npm，仍补 .cmd（但保留原 command 前缀）', () => {
      expect(resolveWindowsCommandShim({ command: 'NPM', cmdCommands: NPM_LIKE, platform: win })).toBe('NPM.cmd');
    });

    it('带目录前缀的命令，basename 匹配时仍补 .cmd', () => {
      expect(
        resolveWindowsCommandShim({
          command: 'C:\\Program Files\\nodejs\\npm',
          cmdCommands: NPM_LIKE,
          platform: win
        })
      ).toBe('C:\\Program Files\\nodejs\\npm.cmd');
    });

    it('不在白名单的命令原样返回', () => {
      expect(resolveWindowsCommandShim({ command: 'node', cmdCommands: NPM_LIKE, platform: win })).toBe('node');
      expect(resolveWindowsCommandShim({ command: 'python', cmdCommands: NPM_LIKE, platform: win })).toBe('python');
    });

    it('空白名单列表时任何命令都不补扩展名', () => {
      expect(resolveWindowsCommandShim({ command: 'npm', cmdCommands: [], platform: win })).toBe('npm');
    });
  });
});
