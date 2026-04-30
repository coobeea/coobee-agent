import path from 'node:path';
import process from 'node:process';
import { normalizeLowercaseStringOrEmpty } from './string-coerce';

/**
 * Windows 上的 npm/pnpm/yarn/npx 是 .cmd shim。
 * 自 Node 18.20 / 20.12 / 22（CVE-2024-27980）起，直接 spawn 这些不带扩展名的
 * 命令会抛 EINVAL，必须显式带 `.cmd`。
 *
 * 注：用 `path.win32.basename` 解析，避免在非 Windows 宿主上运行时 posix 版 basename
 * 丢掉反斜杠路径段的问题（测试 / 预处理场景）。
 */
export function resolveWindowsCommandShim(params: {
  command: string;
  cmdCommands: readonly string[];
  platform?: NodeJS.Platform;
}): string {
  if ((params.platform ?? process.platform) !== 'win32') {
    return params.command;
  }
  const basename = normalizeLowercaseStringOrEmpty(path.win32.basename(params.command));
  if (path.win32.extname(basename)) {
    return params.command;
  }
  if (params.cmdCommands.includes(basename)) {
    return `${params.command}.cmd`;
  }
  return params.command;
}
