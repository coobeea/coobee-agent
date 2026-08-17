import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const PROCESS_MAX_BUFFER_BYTES = 100_000;

type BackgroundState = 'running' | 'exited';

interface BackgroundEntry {
  runId: string;
  sessionId: string;
  command: string;
  cwd: string;
  state: BackgroundState;
  pid?: number;
  startedAt: Date;
  exitedAt?: Date;
  exitCode?: number;
  terminationReason: string;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  cmd?: ChildProcess;
  stdin?: NodeJS.WritableStream;
  done: Promise<void>;
  resolveDone: () => void;
}

export interface BackgroundSnapshot {
  runId: string;
  sessionId: string;
  command: string;
  cwd: string;
  state: BackgroundState;
  pid?: number;
  startedAt: Date;
  exitedAt?: Date;
  exitCode?: number;
  terminationReason: string;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export class BackgroundStore {
  private readonly entries = new Map<string, BackgroundEntry>();

  list(sessionId: string): BackgroundSnapshot[] {
    const out: BackgroundSnapshot[] = [];
    for (const e of this.entries.values()) {
      if (sessionId && e.sessionId !== sessionId) continue;
      out.push(this.snapshot(e));
    }
    return out;
  }

  getOwned(runId: string, sessionId: string): BackgroundEntry | undefined {
    const e = this.entries.get(runId);
    if (!e) return undefined;
    if (!sessionId.trim() || e.sessionId !== sessionId) return undefined;
    return e;
  }

  async startBackground(
    sessionId: string,
    command: string,
    cwd: string,
    extraEnv: Record<string, string>
  ): Promise<string> {
    const runId = randomUUID();
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    const entry: BackgroundEntry = {
      runId,
      sessionId,
      command,
      cwd,
      state: 'running',
      startedAt: new Date(),
      terminationReason: '',
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      done,
      resolveDone
    };
    this.entries.set(runId, entry);

    const child = spawn('bash', ['-c', command], {
      cwd,
      env: { ...process.env, ...extraEnv },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32'
    });

    entry.cmd = child;
    entry.stdin = child.stdin ?? undefined;
    if (child.pid) entry.pid = child.pid;

    const append = (stderr: boolean, chunk: Buffer): void => {
      const field = stderr ? 'stderr' : 'stdout';
      const truncatedField = stderr ? 'stderrTruncated' : 'stdoutTruncated';
      const current = entry[field];
      if (current.length >= PROCESS_MAX_BUFFER_BYTES) {
        entry[truncatedField] = true;
        return;
      }
      const remain = PROCESS_MAX_BUFFER_BYTES - current.length;
      const slice = chunk.length <= remain ? chunk : chunk.subarray(0, remain);
      entry[field] += slice.toString();
      if (chunk.length > remain) entry[truncatedField] = true;
    };

    child.stdout?.on('data', (c: Buffer) => append(false, c));
    child.stderr?.on('data', (c: Buffer) => append(true, c));

    child.on('close', (code) => {
      entry.state = 'exited';
      entry.exitedAt = new Date();
      entry.exitCode = code ?? 1;
      if (!entry.terminationReason) entry.terminationReason = 'exit';
      entry.cmd = undefined;
      entry.stdin = undefined;
      resolveDone();
    });

    child.on('error', () => {
      entry.state = 'exited';
      entry.exitedAt = new Date();
      entry.exitCode = 1;
      entry.terminationReason = 'error';
      resolveDone();
    });

    return runId;
  }

  kill(runId: string, reason: string): boolean {
    const e = this.entries.get(runId);
    if (!e || e.state !== 'running' || !e.cmd) return false;
    e.terminationReason = reason;
    e.cmd.kill('SIGTERM');
    return true;
  }

  remove(runId: string): void {
    this.entries.delete(runId);
  }

  writeStdin(runId: string, data: string): boolean {
    const e = this.entries.get(runId);
    if (!e || e.state !== 'running' || !e.stdin) return false;
    try {
      e.stdin.write(data);
      return true;
    } catch {
      return false;
    }
  }

  async waitForExit(runId: string, timeoutMs?: number): Promise<{ status: string; snap: BackgroundSnapshot }> {
    const e = this.entries.get(runId);
    if (!e) return { status: 'not-found', snap: this.emptySnap() };

    if (e.state === 'exited') {
      return { status: 'exited', snap: this.snapshot(e) };
    }

    if (timeoutMs && timeoutMs > 0) {
      const raced = await Promise.race([
        e.done.then(() => 'done' as const),
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs))
      ]);
      if (raced === 'timeout') {
        return { status: 'timeout', snap: this.snapshot(this.entries.get(runId) ?? e) };
      }
    } else {
      await e.done;
    }

    const latest = this.entries.get(runId);
    if (!latest) return { status: 'not-found', snap: this.emptySnap() };
    return {
      status: latest.state === 'exited' ? 'exited' : 'timeout',
      snap: this.snapshot(latest)
    };
  }

  purgeSession(sessionId: string): number {
    const sid = sessionId.trim();
    if (!sid) return 0;
    let killed = 0;
    for (const [id, e] of this.entries) {
      if (e.sessionId === sid && e.state === 'running') {
        if (this.kill(id, 'stream-end')) killed++;
      }
    }
    for (const [id, e] of this.entries) {
      if (e.sessionId === sid) this.entries.delete(id);
    }
    return killed;
  }

  snapshot(e: BackgroundEntry): BackgroundSnapshot {
    return {
      runId: e.runId,
      sessionId: e.sessionId,
      command: e.command,
      cwd: e.cwd,
      state: e.state,
      pid: e.pid,
      startedAt: e.startedAt,
      exitedAt: e.exitedAt,
      exitCode: e.exitCode,
      terminationReason: e.terminationReason,
      stdout: e.stdout,
      stderr: e.stderr,
      stdoutTruncated: e.stdoutTruncated,
      stderrTruncated: e.stderrTruncated
    };
  }

  private emptySnap(): BackgroundSnapshot {
    return {
      runId: '',
      sessionId: '',
      command: '',
      cwd: '',
      state: 'exited',
      startedAt: new Date(),
      terminationReason: '',
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false
    };
  }
}

let globalStore: BackgroundStore | undefined;

export function getBackgroundStore(): BackgroundStore {
  if (!globalStore) globalStore = new BackgroundStore();
  return globalStore;
}

export function formatBackgroundSummary(s: BackgroundSnapshot): string {
  const parts = [
    `runId: ${s.runId}`,
    `state: ${s.state}`,
    `command: ${s.command}`,
    `cwd: ${s.cwd}`,
    `startedAt: ${s.startedAt.toISOString()}`
  ];
  if (s.pid) parts.push(`pid: ${s.pid}`);
  if (s.state === 'exited') {
    if (s.exitedAt) parts.push(`exitedAt: ${s.exitedAt.toISOString()}`);
    if (s.exitCode != null) parts.push(`exitCode: ${s.exitCode}`);
    if (s.terminationReason) parts.push(`reason: ${s.terminationReason}`);
  }
  return parts.join('\n');
}

export function truncateProcessRead(text: string, label: string): string {
  if (text.length <= PROCESS_MAX_BUFFER_BYTES) return text;
  const truncated = text.slice(0, PROCESS_MAX_BUFFER_BYTES);
  return `${truncated}\n... [${label} truncated at ${PROCESS_MAX_BUFFER_BYTES} bytes; ${text.length} total]`;
}
