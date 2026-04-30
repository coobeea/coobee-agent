import crypto from 'node:crypto';
import { createLogger } from '@main/common/logger';
import { getShellConfig } from '../shell-utils';
import { normalizeOptionalString } from '../string-coerce';
import { createChildAdapter } from './adapters/child';
import { createPtyAdapter } from './adapters/pty';
import { createRunRegistry } from './registry';
import type { ManagedRun, ProcessSupervisor, RunExit, RunRecord, SpawnInput, TerminationReason } from './types';

const log = createLogger('process-supervisor');

type ActiveRun = {
  run: ManagedRun;
  scopeKey?: string;
};

function clampTimeout(value?: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.max(1, Math.floor(value));
}

function isTimeoutReason(reason: TerminationReason): boolean {
  return reason === 'overall-timeout' || reason === 'no-output-timeout';
}

export function createProcessSupervisor(): ProcessSupervisor {
  const registry = createRunRegistry();
  const active = new Map<string, ActiveRun>();

  const cancel = (runId: string, reason: TerminationReason = 'manual-cancel'): void => {
    const current = active.get(runId);
    if (!current) {
      return;
    }
    registry.updateState(runId, 'exiting', {
      terminationReason: reason
    });
    current.run.cancel(reason);
  };

  const cancelScope = (scopeKey: string, reason: TerminationReason = 'manual-cancel'): void => {
    if (!scopeKey.trim()) {
      return;
    }
    for (const [runId, run] of active.entries()) {
      if (run.scopeKey !== scopeKey) {
        continue;
      }
      cancel(runId, reason);
    }
  };

  const spawn = async (input: SpawnInput): Promise<ManagedRun> => {
    const runId = normalizeOptionalString(input.runId) ?? crypto.randomUUID();
    const scopeKey = normalizeOptionalString(input.scopeKey);
    if (input.replaceExistingScope && scopeKey) {
      cancelScope(scopeKey, 'manual-cancel');
    }
    const startedAtMs = Date.now();
    const record: RunRecord = {
      runId,
      sessionId: input.sessionId,
      backendId: input.backendId,
      scopeKey,
      state: 'starting',
      startedAtMs,
      lastOutputAtMs: startedAtMs,
      createdAtMs: startedAtMs,
      updatedAtMs: startedAtMs
    };
    registry.add(record);

    let forcedReason: TerminationReason | null = null;
    let settled = false;
    let stdout = '';
    let stderr = '';
    let timeoutTimer: NodeJS.Timeout | null = null;
    let noOutputTimer: NodeJS.Timeout | null = null;
    const captureOutput = input.captureOutput !== false;

    const overallTimeoutMs = clampTimeout(input.timeoutMs);
    const noOutputTimeoutMs = clampTimeout(input.noOutputTimeoutMs);

    const setForcedReason = (reason: TerminationReason): void => {
      if (forcedReason) return;
      forcedReason = reason;
      registry.updateState(runId, 'exiting', { terminationReason: reason });
    };

    let cancelAdapter: ((reason: TerminationReason) => void) | null = null;

    const requestCancel = (reason: TerminationReason): void => {
      setForcedReason(reason);
      cancelAdapter?.(reason);
    };

    const touchOutput = (): void => {
      registry.touchOutput(runId);
      if (!noOutputTimeoutMs || settled) return;
      if (noOutputTimer) {
        clearTimeout(noOutputTimer);
      }
      noOutputTimer = setTimeout(() => {
        requestCancel('no-output-timeout');
      }, noOutputTimeoutMs);
    };

    try {
      if (input.mode === 'child' && input.argv.length === 0) {
        throw new Error('spawn argv cannot be empty');
      }
      const adapter =
        input.mode === 'pty'
          ? await (async () => {
              const { shell, args: shellArgs } = getShellConfig();
              const ptyCommand = input.ptyCommand.trim();
              if (!ptyCommand) {
                throw new Error('PTY command cannot be empty');
              }
              return await createPtyAdapter({
                shell,
                args: [...shellArgs, ptyCommand],
                cwd: input.cwd,
                env: input.env
              });
            })()
          : await createChildAdapter({
              argv: input.argv,
              cwd: input.cwd,
              env: input.env,
              windowsVerbatimArguments: input.windowsVerbatimArguments,
              input: input.input,
              stdinMode: input.stdinMode
            });

      registry.updateState(runId, 'running', { pid: adapter.pid });

      const clearTimers = (): void => {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        if (noOutputTimer) {
          clearTimeout(noOutputTimer);
          noOutputTimer = null;
        }
      };

      cancelAdapter = (_reason: TerminationReason) => {
        if (settled) return;
        adapter.kill('SIGKILL');
      };

      if (overallTimeoutMs) {
        timeoutTimer = setTimeout(() => {
          requestCancel('overall-timeout');
        }, overallTimeoutMs);
      }
      if (noOutputTimeoutMs) {
        noOutputTimer = setTimeout(() => {
          requestCancel('no-output-timeout');
        }, noOutputTimeoutMs);
      }

      adapter.onStdout((chunk) => {
        if (captureOutput) {
          stdout += chunk;
        }
        input.onStdout?.(chunk);
        touchOutput();
      });
      adapter.onStderr((chunk) => {
        if (captureOutput) {
          stderr += chunk;
        }
        input.onStderr?.(chunk);
        touchOutput();
      });

      const waitPromise = (async (): Promise<RunExit> => {
        const result = await adapter.wait();
        if (settled) {
          return {
            reason: forcedReason ?? 'exit',
            exitCode: result.code,
            exitSignal: result.signal,
            durationMs: Date.now() - startedAtMs,
            stdout,
            stderr,
            timedOut: isTimeoutReason(forcedReason ?? 'exit'),
            noOutputTimedOut: forcedReason === 'no-output-timeout'
          };
        }
        settled = true;
        clearTimers();
        adapter.dispose();
        active.delete(runId);

        const reason: TerminationReason =
          forcedReason ?? (result.signal != null ? ('signal' as const) : ('exit' as const));
        const exit: RunExit = {
          reason,
          exitCode: result.code,
          exitSignal: result.signal,
          durationMs: Date.now() - startedAtMs,
          stdout,
          stderr,
          timedOut: isTimeoutReason(forcedReason ?? reason),
          noOutputTimedOut: forcedReason === 'no-output-timeout'
        };
        registry.finalize(runId, {
          reason: exit.reason,
          exitCode: exit.exitCode,
          exitSignal: exit.exitSignal
        });
        return exit;
      })().catch((err) => {
        if (!settled) {
          settled = true;
          clearTimers();
          active.delete(runId);
          adapter.dispose();
          registry.finalize(runId, {
            reason: 'spawn-error',
            exitCode: null,
            exitSignal: null
          });
        }
        throw err;
      });

      const managedRun: ManagedRun = {
        runId,
        pid: adapter.pid,
        startedAtMs,
        stdin: adapter.stdin,
        wait: async () => await waitPromise,
        cancel: (reason = 'manual-cancel') => {
          requestCancel(reason);
        }
      };

      active.set(runId, {
        run: managedRun,
        scopeKey
      });
      return managedRun;
    } catch (err) {
      registry.finalize(runId, {
        reason: 'spawn-error',
        exitCode: null,
        exitSignal: null
      });
      log.warn(`spawn failed: runId=${runId} reason=${String(err)}`);
      throw err;
    }
  };

  return {
    spawn,
    cancel,
    cancelScope,
    reconcileOrphans: async () => {
      // 主动清理已退出的孤儿运行：当前实现以内存持有状态为准，重启后不恢复。
    },
    getRecord: (runId: string) => registry.get(runId)
  };
}
