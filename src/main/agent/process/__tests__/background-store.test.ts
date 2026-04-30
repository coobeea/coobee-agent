import { describe, it, expect, beforeEach } from 'vitest';
import { createBackgroundStore } from '../background-store';
import type { ManagedRun, RunExit } from '../supervisor/types';

/** 构造一个假 ManagedRun，用于单测 store 不启动真进程 */
function mockRun(opts?: { pid?: number; stdin?: unknown }): {
  run: ManagedRun;
  calls: { cancel: string[]; writes: string[]; ended: number };
} {
  const calls = { cancel: [] as string[], writes: [] as string[], ended: 0 };
  const stdin = {
    destroyed: false,
    write: (data: string) => {
      calls.writes.push(data);
    },
    end: () => {
      calls.ended += 1;
    }
  };
  const run: ManagedRun = {
    runId: 'mock-runid',
    pid: opts?.pid ?? 1234,
    startedAtMs: Date.now(),
    stdin: (opts?.stdin as never) ?? stdin,
    wait: async () => ({
      reason: 'exit',
      exitCode: 0,
      exitSignal: null,
      durationMs: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
      noOutputTimedOut: false
    }),
    cancel: (reason = 'manual-cancel') => {
      calls.cancel.push(String(reason));
    }
  };
  return { run, calls };
}

describe('background-store', () => {
  let store: ReturnType<typeof createBackgroundStore>;

  beforeEach(() => {
    store = createBackgroundStore({ maxOutputBytes: 100 });
  });

  it('register 创建一条 running entry', () => {
    const snap = store.register({
      runId: 'r1',
      sessionId: 's1',
      backendId: 'b1',
      command: 'echo hi',
      cwd: '/tmp'
    });
    expect(snap.state).toBe('running');
    expect(snap.command).toBe('echo hi');
    expect(snap.stdout).toBe('');
    expect(store.get('r1')?.state).toBe('running');
  });

  it('bindRun 把 pid 带上', () => {
    store.register({ runId: 'r1', sessionId: 's1', backendId: 'b1', command: 'x', cwd: '/tmp' });
    const { run } = mockRun({ pid: 999 });
    store.bindRun('r1', run);
    expect(store.get('r1')?.pid).toBe(999);
  });

  it('appendStdout / appendStderr 累积输出 + 精确统计字节数', () => {
    store.register({ runId: 'r1', sessionId: 's1', backendId: 'b1', command: 'x', cwd: '/tmp' });
    store.appendStdout('r1', 'hello');
    store.appendStdout('r1', ' world');
    store.appendStderr('r1', 'oops');
    const got = store.get('r1');
    expect(got?.stdout).toBe('hello world');
    expect(got?.stderr).toBe('oops');
    expect(got?.stdoutBytes).toBe(11);
    expect(got?.stderrBytes).toBe(4);
    expect(got?.stdoutTruncated).toBe(false);
  });

  it('输出超过 maxOutputBytes 会截断 + 置 truncated=true，但 stdoutBytes 计入全量', () => {
    store.register({ runId: 'r1', sessionId: 's1', backendId: 'b1', command: 'x', cwd: '/tmp' });
    const chunk = 'a'.repeat(80);
    store.appendStdout('r1', chunk); // 80 字节，未满
    store.appendStdout('r1', chunk); // 再 80，累计 160 > 100
    const got = store.get('r1');
    expect(got?.stdoutTruncated).toBe(true);
    expect(got?.stdout.length).toBe(100); // 只保留前 100 字符
    expect(got?.stdoutBytes).toBe(160); // 但 bytes 记录的是收到的全量
  });

  it('再 append 已 truncated 的流，truncated 保持为 true，缓冲不增长', () => {
    store.register({ runId: 'r1', sessionId: 's1', backendId: 'b1', command: 'x', cwd: '/tmp' });
    store.appendStdout('r1', 'a'.repeat(200));
    const first = store.get('r1');
    expect(first?.stdout.length).toBe(100);
    expect(first?.stdoutTruncated).toBe(true);
    store.appendStdout('r1', 'b'.repeat(50));
    const second = store.get('r1');
    expect(second?.stdout.length).toBe(100);
    expect(second?.stdoutTruncated).toBe(true);
    expect(second?.stdoutBytes).toBe(250);
  });

  it('markExited 更新 state / exitCode / exitSignal / terminationReason', () => {
    store.register({ runId: 'r1', sessionId: 's1', backendId: 'b1', command: 'x', cwd: '/tmp' });
    const exit: RunExit = {
      reason: 'manual-cancel',
      exitCode: 137,
      exitSignal: 'SIGKILL',
      durationMs: 5,
      stdout: '',
      stderr: '',
      timedOut: false,
      noOutputTimedOut: false
    };
    store.markExited('r1', exit);
    const got = store.get('r1');
    expect(got?.state).toBe('exited');
    expect(got?.exitCode).toBe(137);
    expect(got?.exitSignal).toBe('SIGKILL');
    expect(got?.terminationReason).toBe('manual-cancel');
    expect(got?.exitedAtMs).toBeDefined();
  });

  it('list() 返回所有，list(sessionId) 按 sessionId 过滤', () => {
    store.register({ runId: 'a', sessionId: 's1', backendId: 'b', command: 'x', cwd: '/' });
    store.register({ runId: 'b', sessionId: 's2', backendId: 'b', command: 'x', cwd: '/' });
    store.register({ runId: 'c', sessionId: 's1', backendId: 'b', command: 'x', cwd: '/' });
    expect(store.list().length).toBe(3);
    expect(
      store
        .list('s1')
        .map((e) => e.runId)
        .sort()
    ).toEqual(['a', 'c']);
    expect(store.list('s-none')).toEqual([]);
  });

  it('kill 对 running 进程触发 run.cancel()，exited 进程返回 false', () => {
    store.register({ runId: 'r1', sessionId: 's1', backendId: 'b', command: 'x', cwd: '/' });
    const { run, calls } = mockRun();
    store.bindRun('r1', run);
    expect(store.kill('r1')).toBe(true);
    expect(calls.cancel).toEqual(['manual-cancel']);
    // 模拟已退出
    store.markExited('r1', {
      reason: 'exit',
      exitCode: 0,
      exitSignal: null,
      durationMs: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
      noOutputTimedOut: false
    });
    expect(store.kill('r1')).toBe(false);
  });

  it('kill 未 bindRun 的 entry 返回 false', () => {
    store.register({ runId: 'r1', sessionId: 's1', backendId: 'b', command: 'x', cwd: '/' });
    expect(store.kill('r1')).toBe(false);
  });

  it('writeStdin 成功时返回 true 并把数据写进 stdin', () => {
    store.register({ runId: 'r1', sessionId: 's1', backendId: 'b', command: 'x', cwd: '/' });
    const { run, calls } = mockRun();
    store.bindRun('r1', run);
    expect(store.writeStdin('r1', 'hello\n')).toBe(true);
    expect(calls.writes).toEqual(['hello\n']);
  });

  it('writeStdin 对 exited 或无 stdin 的 entry 返回 false', () => {
    store.register({ runId: 'r1', sessionId: 's1', backendId: 'b', command: 'x', cwd: '/' });
    // 无 run 绑定
    expect(store.writeStdin('r1', 'x')).toBe(false);

    const { run } = mockRun();
    store.bindRun('r1', run);
    store.markExited('r1', {
      reason: 'exit',
      exitCode: 0,
      exitSignal: null,
      durationMs: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
      noOutputTimedOut: false
    });
    expect(store.writeStdin('r1', 'x')).toBe(false);
  });

  it('endStdin 在可写时返回 true 并调用 stdin.end', () => {
    store.register({ runId: 'r1', sessionId: 's1', backendId: 'b', command: 'x', cwd: '/' });
    const { run, calls } = mockRun();
    store.bindRun('r1', run);
    expect(store.endStdin('r1')).toBe(true);
    expect(calls.ended).toBe(1);
  });

  it('remove 删除 entry', () => {
    store.register({ runId: 'r1', sessionId: 's1', backendId: 'b', command: 'x', cwd: '/' });
    store.remove('r1');
    expect(store.get('r1')).toBeUndefined();
  });

  it('append 到不存在的 runId 被忽略（不报错）', () => {
    expect(() => store.appendStdout('missing', 'x')).not.toThrow();
    expect(() => store.appendStderr('missing', 'x')).not.toThrow();
  });

  it('clear 移除所有 entry', () => {
    store.register({ runId: 'a', sessionId: 's', backendId: 'b', command: 'x', cwd: '/' });
    store.register({ runId: 'b', sessionId: 's', backendId: 'b', command: 'x', cwd: '/' });
    store.clear();
    expect(store.list().length).toBe(0);
  });

  it('waitForExit：entry 不存在返 not-found', async () => {
    const result = await store.waitForExit('missing', 100);
    expect(result.status).toBe('not-found');
  });

  it('waitForExit：entry 已退出立即返 exited', async () => {
    store.register({ runId: 'r1', sessionId: 's', backendId: 'b', command: 'x', cwd: '/' });
    const exit: RunExit = {
      reason: 'exit',
      exitCode: 0,
      exitSignal: null,
      durationMs: 10,
      stdout: '',
      stderr: '',
      timedOut: false,
      noOutputTimedOut: false
    };
    store.markExited('r1', exit);
    const result = await store.waitForExit('r1');
    expect(result.status).toBe('exited');
    if (result.status === 'exited') {
      expect(result.entry.exitCode).toBe(0);
      expect(result.entry.terminationReason).toBe('exit');
    }
  });

  it('waitForExit：挂起等待 → markExited 后同步 resolve', async () => {
    store.register({ runId: 'r1', sessionId: 's', backendId: 'b', command: 'x', cwd: '/' });
    const p = store.waitForExit('r1');
    // 绝不能立刻 resolve
    let resolved = false;
    p.then(() => {
      resolved = true;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).toBe(false);

    store.markExited('r1', {
      reason: 'exit',
      exitCode: 42,
      exitSignal: null,
      durationMs: 20,
      stdout: '',
      stderr: '',
      timedOut: false,
      noOutputTimedOut: false
    });
    const result = await p;
    expect(result.status).toBe('exited');
    if (result.status === 'exited') {
      expect(result.entry.exitCode).toBe(42);
    }
  });

  it('waitForExit：timeoutMs 内未退出返 timeout，后续 markExited 不再触发', async () => {
    store.register({ runId: 'r1', sessionId: 's', backendId: 'b', command: 'x', cwd: '/' });
    const result = await store.waitForExit('r1', 30);
    expect(result.status).toBe('timeout');
    if (result.status === 'timeout') {
      expect(result.entry.state).toBe('running');
    }

    // 后补一个 markExited，不应该抛（waiter 已被移除）
    expect(() =>
      store.markExited('r1', {
        reason: 'exit',
        exitCode: 0,
        exitSignal: null,
        durationMs: 0,
        stdout: '',
        stderr: '',
        timedOut: false,
        noOutputTimedOut: false
      })
    ).not.toThrow();
    expect(store.get('r1')?.state).toBe('exited');
  });

  it('waitForExit：多个并发调用同时被 markExited resolve', async () => {
    store.register({ runId: 'r1', sessionId: 's', backendId: 'b', command: 'x', cwd: '/' });
    const p1 = store.waitForExit('r1');
    const p2 = store.waitForExit('r1');
    const p3 = store.waitForExit('r1', 5000);

    store.markExited('r1', {
      reason: 'signal',
      exitCode: null,
      exitSignal: 'SIGKILL',
      durationMs: 100,
      stdout: '',
      stderr: '',
      timedOut: false,
      noOutputTimedOut: false
    });

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1.status).toBe('exited');
    expect(r2.status).toBe('exited');
    expect(r3.status).toBe('exited');
  });
});
