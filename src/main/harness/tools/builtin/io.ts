import { spawn } from 'node:child_process';
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';

export async function readFileLimited(filePath: string, maxBytes: number): Promise<Buffer> {
  const data = await readFile(filePath);
  if (maxBytes > 0 && data.length > maxBytes) {
    return data.subarray(0, maxBytes);
  }
  return data;
}

export async function statFile(filePath: string): Promise<Awaited<ReturnType<typeof stat>>> {
  return stat(filePath);
}

export async function writeFileEnsured(filePath: string, data: string | Buffer): Promise<void> {
  await writeFile(filePath, data, { mode: 0o644 });
}

export async function mkdirParent(filePath: string): Promise<void> {
  const { dirname } = await import('node:path');
  await mkdir(dirname(filePath), { recursive: true, mode: 0o755 });
}

export async function isBinaryFile(filePath: string): Promise<boolean> {
  const buf = await readFileLimited(filePath, 8192);
  if (buf.length === 0) return false;
  let nonText = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0) return true;
    if (buf[i]! < 32 && buf[i] !== 9 && buf[i] !== 10 && buf[i] !== 13) {
      nonText++;
    }
  }
  return nonText * 3 > buf.length;
}

export function formatNumberedLines(content: string, offset: number, limit: number): string {
  const lines = content.split('\n');
  const start = Math.max(0, offset - 1);
  const end = Math.min(lines.length, start + limit);
  const out: string[] = [];
  for (let i = start; i < end; i++) {
    const lineNum = String(i + 1).padStart(4, ' ');
    out.push(`${lineNum}|${lines[i]}`);
  }
  return out.join('\n').replace(/\n$/, '');
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  aborted: boolean;
}

export function runShell(
  cwd: string,
  command: string,
  options?: { timeoutMs?: number; env?: Record<string, string>; signal?: AbortSignal }
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const extraEnv = options?.env ?? {};
    const child = spawn('bash', ['-c', command], {
      cwd,
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    if (options?.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, options.timeoutMs);
    }

    const onAbort = (): void => {
      aborted = true;
      child.kill('SIGTERM');
    };
    options?.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      options?.signal?.removeEventListener('abort', onAbort);
      reject(err);
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      options?.signal?.removeEventListener('abort', onAbort);
      let exitCode = code ?? 1;
      if (timedOut) exitCode = 124;
      if (aborted) exitCode = 130;
      resolve({ stdout, stderr, exitCode, timedOut, aborted });
    });
  });
}

export function runCommand(cwd: string, bin: string, args: string[], signal?: AbortSignal): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let aborted = false;

    const onAbort = (): void => {
      aborted = true;
      child.kill('SIGTERM');
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      resolve({
        stdout,
        stderr,
        exitCode: aborted ? 130 : (code ?? 1),
        timedOut: false,
        aborted
      });
    });
  });
}

export async function commandExists(bin: string): Promise<boolean> {
  try {
    const res = await runCommand(process.cwd(), 'which', [bin]);
    return res.exitCode === 0 && res.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export function truncateOutput(text: string, maxBytes: number): string {
  if (text.length <= maxBytes) return text;
  return `${text.slice(0, maxBytes)}\n... [output truncated]`;
}
