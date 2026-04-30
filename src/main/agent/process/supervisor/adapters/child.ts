import type { ChildProcessWithoutNullStreams, SpawnOptions } from 'node:child_process';
import { killProcessTree } from '../../kill-tree';
import { prepareOomScoreAdjustedSpawn } from '../../linux-oom-score';
import { spawnWithFallback } from '../../spawn-utils';
import { resolveWindowsCommandShim } from '../../windows-command';
import { createWindowsOutputDecoder } from '../../windows-encoding';
import type { ManagedRunStdin, SpawnProcessAdapter } from '../types';
import { toStringEnv } from './env';

const FORCE_KILL_WAIT_FALLBACK_MS = 4000;
const WINDOWS_CLOSE_STATE_SETTLE_TIMEOUT_MS = 250;

function resolveCommand(command: string): string {
  return resolveWindowsCommandShim({
    command,
    cmdCommands: ['npm', 'pnpm', 'yarn', 'npx']
  });
}

export type ChildAdapter = SpawnProcessAdapter<NodeJS.Signals | null>;

/**
 * service-managed runtime（launchd / systemd 等）希望子进程保持 attached，
 * 这样父单元被停掉时整棵进程树能一并回收。用 env marker 来切换该行为。
 */
function isServiceManagedRuntime(): boolean {
  return Boolean(process.env.COOBEE_SERVICE_MARKER?.trim());
}

export async function createChildAdapter(params: {
  argv: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  windowsVerbatimArguments?: boolean;
  input?: string;
  stdinMode?: 'inherit' | 'pipe-open' | 'pipe-closed';
}): Promise<ChildAdapter> {
  const resolvedArgv = [...params.argv];
  resolvedArgv[0] = resolveCommand(resolvedArgv[0] ?? '');
  const baseEnv = params.env ? toStringEnv(params.env) : undefined;
  const preparedSpawn = prepareOomScoreAdjustedSpawn(resolvedArgv[0] ?? '', resolvedArgv.slice(1), {
    env: baseEnv
  });

  const stdinMode = params.stdinMode ?? (params.input !== undefined ? 'pipe-closed' : 'inherit');

  const useDetached = process.platform !== 'win32' && !isServiceManagedRuntime();

  const options: SpawnOptions = {
    cwd: params.cwd,
    env: preparedSpawn.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: useDetached,
    windowsHide: true,
    windowsVerbatimArguments: params.windowsVerbatimArguments
  };
  if (stdinMode === 'inherit') {
    options.stdio = ['inherit', 'pipe', 'pipe'];
  } else {
    options.stdio = ['pipe', 'pipe', 'pipe'];
  }

  const spawned = await spawnWithFallback({
    argv: [preparedSpawn.command, ...preparedSpawn.args],
    options,
    fallbacks: useDetached
      ? [
          {
            label: 'no-detach',
            options: { detached: false }
          }
        ]
      : []
  });

  const child = spawned.child as ChildProcessWithoutNullStreams;
  if (child.stdin) {
    if (params.input !== undefined) {
      child.stdin.write(params.input);
      child.stdin.end();
    } else if (stdinMode === 'pipe-closed') {
      child.stdin.end();
    }
  }

  const stdin: ManagedRunStdin | undefined = child.stdin
    ? {
        destroyed: false,
        write: (data: string, cb?: (err?: Error | null) => void) => {
          try {
            child.stdin.write(data, cb);
          } catch (err) {
            cb?.(err as Error);
          }
        },
        end: () => {
          try {
            child.stdin.end();
          } catch {
            // ignore close errors
          }
        },
        destroy: () => {
          try {
            child.stdin.destroy();
          } catch {
            // ignore destroy errors
          }
        }
      }
    : undefined;

  const onStdout = (listener: (chunk: string) => void): void => {
    const stdoutDecoder = createWindowsOutputDecoder();
    let flushed = false;
    const flush = (): void => {
      if (flushed) return;
      flushed = true;
      const tail = stdoutDecoder.flush();
      if (tail) {
        listener(tail);
      }
    };
    child.stdout.on('data', (chunk) => {
      const text = stdoutDecoder.decode(chunk);
      if (text) {
        listener(text);
      }
    });
    child.stdout.once('end', flush);
    child.stdout.once('close', flush);
  };

  const onStderr = (listener: (chunk: string) => void): void => {
    const stderrDecoder = createWindowsOutputDecoder();
    let flushed = false;
    const flush = (): void => {
      if (flushed) return;
      flushed = true;
      const tail = stderrDecoder.flush();
      if (tail) {
        listener(tail);
      }
    };
    child.stderr.on('data', (chunk) => {
      const text = stderrDecoder.decode(chunk);
      if (text) {
        listener(text);
      }
    });
    child.stderr.once('end', flush);
    child.stderr.once('close', flush);
  };

  let waitResult: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  let waitError: unknown;
  let resolveWait: ((value: { code: number | null; signal: NodeJS.Signals | null }) => void) | null = null;
  let rejectWait: ((reason?: unknown) => void) | null = null;
  let waitPromise: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | null = null;
  let forceKillWaitFallbackTimer: NodeJS.Timeout | null = null;
  let childExitState: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  let windowsCloseFallbackTimer: NodeJS.Timeout | null = null;
  let stdoutDrained = child.stdout == null;
  let stderrDrained = child.stderr == null;

  const clearForceKillWaitFallback = (): void => {
    if (!forceKillWaitFallbackTimer) return;
    clearTimeout(forceKillWaitFallbackTimer);
    forceKillWaitFallbackTimer = null;
  };

  const clearWindowsCloseFallbackTimer = (): void => {
    if (!windowsCloseFallbackTimer) return;
    clearTimeout(windowsCloseFallbackTimer);
    windowsCloseFallbackTimer = null;
  };

  const settleWait = (value: { code: number | null; signal: NodeJS.Signals | null }): void => {
    if (waitResult || waitError !== undefined) return;
    clearForceKillWaitFallback();
    clearWindowsCloseFallbackTimer();
    waitResult = value;
    if (resolveWait) {
      const resolve = resolveWait;
      resolveWait = null;
      rejectWait = null;
      resolve(value);
    }
  };

  const rejectPendingWait = (error: unknown): void => {
    if (waitResult || waitError !== undefined) return;
    clearForceKillWaitFallback();
    clearWindowsCloseFallbackTimer();
    waitError = error;
    if (rejectWait) {
      const reject = rejectWait;
      resolveWait = null;
      rejectWait = null;
      reject(error);
    }
  };

  const scheduleForceKillWaitFallback = (signal: NodeJS.Signals): void => {
    clearForceKillWaitFallback();
    // 某些 Windows 子进程硬杀后不再触发 close。
    forceKillWaitFallbackTimer = setTimeout(() => {
      settleWait({ code: null, signal });
    }, FORCE_KILL_WAIT_FALLBACK_MS);
    forceKillWaitFallbackTimer.unref?.();
  };

  const resolveObservedExitState = (fallback: {
    code: number | null;
    signal: NodeJS.Signals | null;
  }): { code: number | null; signal: NodeJS.Signals | null } => {
    if (childExitState != null) {
      return childExitState;
    }
    return {
      code: child.exitCode ?? fallback.code,
      signal: child.signalCode ?? fallback.signal
    };
  };

  const maybeSettleAfterWindowsExit = (): void => {
    if (process.platform !== 'win32' || childExitState == null || !stdoutDrained || !stderrDrained) {
      return;
    }
    settleWait(resolveObservedExitState(childExitState));
  };

  const scheduleWindowsCloseFallback = (): void => {
    if (process.platform !== 'win32') return;
    clearWindowsCloseFallbackTimer();
    windowsCloseFallbackTimer = setTimeout(() => {
      maybeSettleAfterWindowsExit();
    }, WINDOWS_CLOSE_STATE_SETTLE_TIMEOUT_MS);
    windowsCloseFallbackTimer.unref?.();
  };

  child.stdout?.once('end', () => {
    stdoutDrained = true;
    maybeSettleAfterWindowsExit();
  });
  child.stdout?.once('close', () => {
    stdoutDrained = true;
    maybeSettleAfterWindowsExit();
  });
  child.stderr?.once('end', () => {
    stderrDrained = true;
    maybeSettleAfterWindowsExit();
  });
  child.stderr?.once('close', () => {
    stderrDrained = true;
    maybeSettleAfterWindowsExit();
  });

  child.once('error', (error) => {
    rejectPendingWait(error);
  });
  child.once('exit', (code, signal) => {
    childExitState = { code, signal };
    scheduleWindowsCloseFallback();
  });
  child.once('close', (code, signal) => {
    settleWait(resolveObservedExitState({ code, signal }));
  });

  const wait = async (): Promise<{ code: number | null; signal: NodeJS.Signals | null }> => {
    if (waitResult) return waitResult;
    if (waitError !== undefined) throw waitError;
    if (!waitPromise) {
      waitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        resolveWait = resolve;
        rejectWait = reject;
        if (waitResult) {
          const settled = waitResult;
          resolveWait = null;
          rejectWait = null;
          resolve(settled);
          return;
        }
        if (waitError !== undefined) {
          const error = waitError;
          resolveWait = null;
          rejectWait = null;
          reject(error);
        }
      });
    }
    return waitPromise;
  };

  // detached 的实际生效情况可能和 `useDetached` 不同：当首次 detached spawn 抛
  // EBADF 被 `spawnWithFallback` 降级到 no-detach 时，子进程和父进程共享同一
  // process group，此时必须避免 `-pid` 组杀。
  const childIsDetached = useDetached && !spawned.usedFallback;
  const kill = (signal?: NodeJS.Signals): void => {
    const pid = child.pid ?? undefined;
    if (signal === undefined || signal === 'SIGKILL') {
      if (pid) {
        killProcessTree(pid, { detached: childIsDetached });
      }
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore kill errors
      }
      scheduleForceKillWaitFallback('SIGKILL');
      return;
    }
    try {
      child.kill(signal);
    } catch {
      // ignore kill errors for non-kill signals
    }
  };

  const dispose = (): void => {
    clearForceKillWaitFallback();
    clearWindowsCloseFallbackTimer();
    child.removeAllListeners();
  };

  return {
    pid: child.pid ?? undefined,
    stdin,
    onStdout,
    onStderr,
    wait,
    kill,
    dispose
  };
}
