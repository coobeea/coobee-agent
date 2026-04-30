/**
 * 后台进程存储
 *
 * 配合 ProcessSupervisor 的 `captureOutput: false` 模式使用：
 *   - exec(background) 调 supervisor.spawn 拿到 ManagedRun
 *   - 通过 register 把 run 与描述信息登记进来
 *   - onStdout/onStderr 回调转发到 appendStdout/appendStderr
 *   - run.wait() 完成后调 markExited 记录退出信息
 *   - process 工具通过 list / get / kill / writeStdin 读写状态
 *
 * 本存储只保留"前缀式"输出（和 foreground 的 100KB 截断一致），超过上限后
 * 追加的 chunk 被丢弃并设置 truncated 标志。这样不会因为长驻 dev server
 * 产生内存爆炸。
 */
import type { ManagedRun, RunExit, TerminationReason } from './supervisor/types';

/** 每条后台记录保留的最大 stdout / stderr 字节数（默认 256KB） */
export const DEFAULT_MAX_OUTPUT_BYTES = 256_000;

export type BackgroundState = 'running' | 'exited';

export interface BackgroundEntrySnapshot {
  runId: string;
  sessionId: string;
  backendId: string;
  command: string;
  cwd: string;
  pid?: number;
  state: BackgroundState;
  startedAtMs: number;
  exitedAtMs?: number;
  exitCode?: number | null;
  exitSignal?: NodeJS.Signals | number | null;
  terminationReason?: TerminationReason;
  stdout: string;
  stderr: string;
  stdoutBytes: number; // 已接收的原始字节数（含被丢弃部分）
  stderrBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

interface InternalEntry {
  runId: string;
  sessionId: string;
  backendId: string;
  command: string;
  cwd: string;
  pid?: number;
  state: BackgroundState;
  startedAtMs: number;
  exitedAtMs?: number;
  exitCode?: number | null;
  exitSignal?: NodeJS.Signals | number | null;
  terminationReason?: TerminationReason;
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  run?: ManagedRun;
  /** 等待这条 entry 进入 exited 的回调列表；markExited 时一次性 resolve 并清空 */
  exitWaiters: Array<(snapshot: BackgroundEntrySnapshot) => void>;
}

export type WaitResult =
  | { status: 'exited'; entry: BackgroundEntrySnapshot }
  | { status: 'timeout'; entry: BackgroundEntrySnapshot }
  | { status: 'not-found' };

export interface BackgroundStore {
  /**
   * 预登记一条 entry。调用方随后可用相同 runId 驱动 appendStdout / bindRun / markExited。
   */
  register(input: {
    runId: string;
    sessionId: string;
    backendId: string;
    command: string;
    cwd: string;
  }): BackgroundEntrySnapshot;
  /** 把 spawn 好的 ManagedRun 绑定到已 register 的 entry 上（更新 pid） */
  bindRun(runId: string, run: ManagedRun): void;
  appendStdout(runId: string, chunk: string): void;
  appendStderr(runId: string, chunk: string): void;
  markExited(runId: string, exit: RunExit): void;
  get(runId: string): BackgroundEntrySnapshot | undefined;
  list(sessionId?: string): BackgroundEntrySnapshot[];
  kill(runId: string, reason?: TerminationReason): boolean;
  writeStdin(runId: string, data: string): boolean;
  endStdin(runId: string): boolean;
  /**
   * 等待指定 runId 的进程退出。
   * - entry 不存在 → 立即 { status: 'not-found' }
   * - entry 已退出 → 立即 { status: 'exited', entry }
   * - 仍在运行：挂起等待；timeoutMs 内未退出返 { status: 'timeout', entry }，未传则永远等待
   */
  waitForExit(runId: string, timeoutMs?: number): Promise<WaitResult>;
  /** 从 store 中移除一条 entry（用于长期未清理的回收） */
  remove(runId: string): void;
  /** 仅测试 / 清理用，重置全部 entries */
  clear(): void;
}

export function createBackgroundStore(options?: { maxOutputBytes?: number }): BackgroundStore {
  const maxBytes = resolveMaxBytes(options?.maxOutputBytes);
  const entries = new Map<string, InternalEntry>();

  function snapshot(entry: InternalEntry): BackgroundEntrySnapshot {
    return {
      runId: entry.runId,
      sessionId: entry.sessionId,
      backendId: entry.backendId,
      command: entry.command,
      cwd: entry.cwd,
      pid: entry.pid,
      state: entry.state,
      startedAtMs: entry.startedAtMs,
      exitedAtMs: entry.exitedAtMs,
      exitCode: entry.exitCode,
      exitSignal: entry.exitSignal,
      terminationReason: entry.terminationReason,
      stdout: entry.stdout,
      stderr: entry.stderr,
      stdoutBytes: entry.stdoutBytes,
      stderrBytes: entry.stderrBytes,
      stdoutTruncated: entry.stdoutTruncated,
      stderrTruncated: entry.stderrTruncated
    };
  }

  function appendChunk(entry: InternalEntry, stream: 'stdout' | 'stderr', chunk: string): void {
    if (!chunk) return;
    const bytes = Buffer.byteLength(chunk, 'utf-8');
    const currentBytes = stream === 'stdout' ? entry.stdoutBytes : entry.stderrBytes;
    const currentBuf = stream === 'stdout' ? entry.stdout : entry.stderr;
    const remain = maxBytes - currentBuf.length;
    let nextBuf = currentBuf;
    let truncated = stream === 'stdout' ? entry.stdoutTruncated : entry.stderrTruncated;
    if (remain > 0) {
      if (chunk.length <= remain) {
        nextBuf = currentBuf + chunk;
      } else {
        nextBuf = currentBuf + chunk.slice(0, remain);
        truncated = true;
      }
    } else {
      truncated = true;
    }
    if (stream === 'stdout') {
      entry.stdout = nextBuf;
      entry.stdoutBytes = currentBytes + bytes;
      entry.stdoutTruncated = truncated;
    } else {
      entry.stderr = nextBuf;
      entry.stderrBytes = currentBytes + bytes;
      entry.stderrTruncated = truncated;
    }
  }

  return {
    register(input) {
      const entry: InternalEntry = {
        runId: input.runId,
        sessionId: input.sessionId,
        backendId: input.backendId,
        command: input.command,
        cwd: input.cwd,
        state: 'running',
        startedAtMs: Date.now(),
        stdout: '',
        stderr: '',
        stdoutBytes: 0,
        stderrBytes: 0,
        stdoutTruncated: false,
        stderrTruncated: false,
        exitWaiters: []
      };
      entries.set(entry.runId, entry);
      return snapshot(entry);
    },
    bindRun(runId, run) {
      const entry = entries.get(runId);
      if (!entry) return;
      entry.run = run;
      entry.pid = run.pid;
    },
    appendStdout(runId, chunk) {
      const entry = entries.get(runId);
      if (!entry) return;
      appendChunk(entry, 'stdout', chunk);
    },
    appendStderr(runId, chunk) {
      const entry = entries.get(runId);
      if (!entry) return;
      appendChunk(entry, 'stderr', chunk);
    },
    markExited(runId, exit) {
      const entry = entries.get(runId);
      if (!entry) return;
      entry.state = 'exited';
      entry.exitedAtMs = Date.now();
      entry.exitCode = exit.exitCode;
      entry.exitSignal = exit.exitSignal;
      entry.terminationReason = exit.reason;
      // resolve 所有等 waitForExit 的调用方
      if (entry.exitWaiters.length > 0) {
        const snap = snapshot(entry);
        const waiters = entry.exitWaiters;
        entry.exitWaiters = [];
        for (const resolve of waiters) {
          try {
            resolve(snap);
          } catch {
            // ignore
          }
        }
      }
    },
    get(runId) {
      const entry = entries.get(runId);
      return entry ? snapshot(entry) : undefined;
    },
    list(sessionId) {
      const all = Array.from(entries.values());
      const filtered = sessionId ? all.filter((e) => e.sessionId === sessionId) : all;
      return filtered.map(snapshot);
    },
    kill(runId, reason = 'manual-cancel') {
      const entry = entries.get(runId);
      if (!entry || !entry.run) return false;
      if (entry.state === 'exited') return false;
      entry.run.cancel(reason);
      return true;
    },
    writeStdin(runId, data) {
      const entry = entries.get(runId);
      if (!entry || !entry.run || entry.state === 'exited') return false;
      const stdin = entry.run.stdin;
      if (!stdin || stdin.destroyed) return false;
      stdin.write(data);
      return true;
    },
    endStdin(runId) {
      const entry = entries.get(runId);
      if (!entry || !entry.run || entry.state === 'exited') return false;
      const stdin = entry.run.stdin;
      if (!stdin || stdin.destroyed) return false;
      stdin.end();
      return true;
    },
    async waitForExit(runId, timeoutMs) {
      const entry = entries.get(runId);
      if (!entry) return { status: 'not-found' };
      if (entry.state === 'exited') {
        return { status: 'exited', entry: snapshot(entry) };
      }
      return await new Promise<WaitResult>((resolve) => {
        let settled = false;
        let timer: NodeJS.Timeout | null = null;

        const onExit = (snap: BackgroundEntrySnapshot): void => {
          if (settled) return;
          settled = true;
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          resolve({ status: 'exited', entry: snap });
        };
        entry.exitWaiters.push(onExit);

        if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
          timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            // 从 waiters 中移除本调用，避免后续 markExited 再触发
            const idx = entry.exitWaiters.indexOf(onExit);
            if (idx >= 0) entry.exitWaiters.splice(idx, 1);
            resolve({ status: 'timeout', entry: snapshot(entry) });
          }, timeoutMs);
          timer.unref?.();
        }
      });
    },
    remove(runId) {
      entries.delete(runId);
    },
    clear() {
      entries.clear();
    }
  };
}

function resolveMaxBytes(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_MAX_OUTPUT_BYTES;
  }
  return Math.max(1, Math.floor(value));
}

let singleton: BackgroundStore | null = null;

/**
 * 返回进程内单例 BackgroundStore。
 * 测试可直接 `createBackgroundStore()` 造独立实例，或调用 `.clear()` 重置状态。
 */
export function getBackgroundStore(): BackgroundStore {
  if (singleton) return singleton;
  singleton = createBackgroundStore();
  return singleton;
}
