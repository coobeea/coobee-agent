import { spawn } from 'node:child_process';

const DEFAULT_GRACE_MS = 3000;
const MAX_GRACE_MS = 60_000;

/**
 * 最佳努力的进程树回收，带 graceful shutdown。
 * - Windows：用 taskkill /T 处理整棵树，先不带 /F 让子进程清理，过 grace 再 /F /T。
 * - Unix：先给 process group 发 SIGTERM，等 grace 过后再 SIGKILL。
 *
 * 当 child 用 `detached: false` 启动（例如 launchd / systemd 托管运行时），必须
 * 传 `detached: false`，避免 `-pid` 组杀触及到 gateway 自身的 process group。
 */
export function killProcessTree(pid: number, opts?: { graceMs?: number; detached?: boolean }): void {
  if (!Number.isFinite(pid) || pid <= 0) {
    return;
  }

  const graceMs = normalizeGraceMs(opts?.graceMs);

  if (process.platform === 'win32') {
    killProcessTreeWindows(pid, graceMs);
    return;
  }

  killProcessTreeUnix(pid, graceMs, opts?.detached !== false);
}

function normalizeGraceMs(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_GRACE_MS;
  }
  return Math.max(0, Math.min(MAX_GRACE_MS, Math.floor(value)));
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killProcessTreeUnix(pid: number, graceMs: number, useGroupKill: boolean): void {
  if (useGroupKill) {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        return;
      }
    }
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return;
    }
  }

  setTimeout(() => {
    if (useGroupKill && isProcessAlive(-pid)) {
      try {
        process.kill(-pid, 'SIGKILL');
        return;
      } catch {
        // fall through
      }
    }
    if (!isProcessAlive(pid)) {
      return;
    }
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }, graceMs).unref();
}

function runTaskkill(args: string[]): void {
  try {
    spawn('taskkill', args, {
      stdio: 'ignore',
      detached: true,
      windowsHide: true
    });
  } catch {
    // taskkill 缺失或 spawn 失败都吞掉
  }
}

function killProcessTreeWindows(pid: number, graceMs: number): void {
  runTaskkill(['/T', '/PID', String(pid)]);

  setTimeout(() => {
    if (!isProcessAlive(pid)) {
      return;
    }
    runTaskkill(['/F', '/T', '/PID', String(pid)]);
  }, graceMs).unref();
}
