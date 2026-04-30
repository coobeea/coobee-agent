import fs from 'node:fs';
import path from 'node:path';

/**
 * Windows 上优先选 PowerShell 7（pwsh.exe），PS 5.1 不支持 `&&` 连接符。
 */
export function resolvePowerShellPath(): string {
  const programFiles = process.env.ProgramFiles || process.env.PROGRAMFILES || 'C:\\Program Files';
  const pwsh7 = path.join(programFiles, 'PowerShell', '7', 'pwsh.exe');
  if (fs.existsSync(pwsh7)) {
    return pwsh7;
  }

  const programW6432 = process.env.ProgramW6432;
  if (programW6432 && programW6432 !== programFiles) {
    const pwsh7Alt = path.join(programW6432, 'PowerShell', '7', 'pwsh.exe');
    if (fs.existsSync(pwsh7Alt)) {
      return pwsh7Alt;
    }
  }

  const pwshInPath = resolveShellFromPath('pwsh');
  if (pwshInPath) {
    return pwshInPath;
  }

  const systemRoot = process.env.SystemRoot || process.env.WINDIR;
  if (systemRoot) {
    const candidate = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return 'powershell.exe';
}

// 非交互占位 shell，拒绝 `-c` 调用。macOS LaunchDaemon 的服务用户常把 shell
// 设为 /usr/bin/false 阻止登录；这种情况下如果照搬 SHELL env 会让每条 exec 直接退 1。
const NON_INTERACTIVE_SHELLS = new Set(['false', 'nologin']);

function isNonInteractiveShell(shellPath: string): boolean {
  if (!shellPath) {
    return false;
  }
  return NON_INTERACTIVE_SHELLS.has(path.basename(shellPath));
}

function getPosixShellArgs(shellPath: string): string[] {
  switch (path.basename(shellPath)) {
    case 'bash':
      return ['--noprofile', '--norc', '-c'];
    case 'zsh':
      return ['-f', '-c'];
    case 'fish':
      return ['--no-config', '-c'];
    default:
      return ['-c'];
  }
}

export function resolveShellFromPath(name: string): string | undefined {
  const envPath = process.env.PATH ?? '';
  if (!envPath) {
    return undefined;
  }
  const entries = envPath.split(path.delimiter).filter(Boolean);
  for (const entry of entries) {
    const candidate = path.join(entry, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // 缺失或不可执行继续找下一个
    }
  }
  return undefined;
}

/**
 * 返回用于 `-c` 式调用的 shell 可执行路径及参数。
 * - Windows → pwsh / powershell，避免 cmd.exe 丢失 WriteConsole API 直接写控制台的工具输出
 * - POSIX   → 依据 SHELL 或 sh 兜底，fish 场景下退回到 bash/sh
 */
export function getShellConfig(): { shell: string; args: string[] } {
  if (process.platform === 'win32') {
    return {
      shell: resolvePowerShellPath(),
      args: ['-NoProfile', '-NonInteractive', '-Command']
    };
  }

  const rawEnvShell = process.env.SHELL?.trim();
  const envShell = rawEnvShell && !isNonInteractiveShell(rawEnvShell) ? rawEnvShell : undefined;
  const shellName = envShell ? path.basename(envShell) : '';
  if (shellName === 'fish') {
    const bash = resolveShellFromPath('bash');
    if (bash) {
      return { shell: bash, args: getPosixShellArgs(bash) };
    }
    const sh = resolveShellFromPath('sh');
    if (sh) {
      return { shell: sh, args: getPosixShellArgs(sh) };
    }
  }
  if (envShell) {
    return { shell: envShell, args: getPosixShellArgs(envShell) };
  }
  const shell = resolveShellFromPath('sh') ?? resolveShellFromPath('bash') ?? 'sh';
  return { shell, args: getPosixShellArgs(shell) };
}
