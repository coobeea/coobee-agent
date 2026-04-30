/**
 * supervisor 端到端测试 —— 用真实 child_process 启动短命令，验证：
 *   - stdout / stderr 走回调 + captureOutput 两条路径
 *   - exit 事件正确落到 RunExit.reason / exitCode
 *   - cancel('manual-cancel') 能中断长驻进程，reason 归为 manual-cancel
 *   - scope 级别 cancelScope 把同 scopeKey 的 run 一起杀掉
 *   - getRecord 能读出状态机变化（starting → running → exited）
 *
 * 为避免依赖 Electron / 真实配置，mock 掉 @main/common/logger。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@main/common/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}));

import { createProcessSupervisor } from '../supervisor/supervisor';

describe('ProcessSupervisor (child mode, e2e)', () => {
  let supervisor: ReturnType<typeof createProcessSupervisor>;

  beforeEach(() => {
    supervisor = createProcessSupervisor();
  });

  it('spawn + wait：stdout 完整累积，exitCode=0，reason=exit', async () => {
    const chunks: string[] = [];
    const run = await supervisor.spawn({
      mode: 'child',
      sessionId: 's',
      backendId: 'b',
      argv: [process.execPath, '-e', 'process.stdout.write("hello"); process.exit(0)'],
      onStdout: (c) => chunks.push(c)
    });
    const exit = await run.wait();
    expect(exit.reason).toBe('exit');
    expect(exit.exitCode).toBe(0);
    expect(exit.stdout).toBe('hello');
    expect(chunks.join('')).toBe('hello');
  });

  it('captureOutput=false 时 RunExit.stdout 为空，只走回调', async () => {
    const chunks: string[] = [];
    const run = await supervisor.spawn({
      mode: 'child',
      sessionId: 's',
      backendId: 'b',
      argv: [process.execPath, '-e', 'process.stdout.write("hi")'],
      captureOutput: false,
      onStdout: (c) => chunks.push(c)
    });
    const exit = await run.wait();
    expect(exit.stdout).toBe('');
    expect(chunks.join('')).toBe('hi');
  });

  it('stderr 走独立回调 + 独立累积', async () => {
    const run = await supervisor.spawn({
      mode: 'child',
      sessionId: 's',
      backendId: 'b',
      argv: [process.execPath, '-e', 'process.stderr.write("oops"); process.exit(2)']
    });
    const exit = await run.wait();
    expect(exit.exitCode).toBe(2);
    expect(exit.stderr).toBe('oops');
  });

  it('非零退出码：reason=exit，exitCode=非零', async () => {
    const run = await supervisor.spawn({
      mode: 'child',
      sessionId: 's',
      backendId: 'b',
      argv: [process.execPath, '-e', 'process.exit(7)']
    });
    const exit = await run.wait();
    expect(exit.reason).toBe('exit');
    expect(exit.exitCode).toBe(7);
  });

  it('manual cancel：reason=manual-cancel，exitCode=null', async () => {
    const run = await supervisor.spawn({
      mode: 'child',
      sessionId: 's',
      backendId: 'b',
      argv: [process.execPath, '-e', 'setInterval(()=>{}, 1000)']
    });
    // 小 delay 确保进程真的起来
    await new Promise((r) => setTimeout(r, 50));
    run.cancel('manual-cancel');
    const exit = await run.wait();
    expect(exit.reason).toBe('manual-cancel');
    // 被 SIGKILL 时 exitCode 通常为 null，signal 为 SIGKILL
    expect(exit.exitCode).toBeNull();
  }, 15000);

  it('overall-timeout：自动 kill，reason=overall-timeout，timedOut=true', async () => {
    const run = await supervisor.spawn({
      mode: 'child',
      sessionId: 's',
      backendId: 'b',
      argv: [process.execPath, '-e', 'setInterval(()=>{}, 1000)'],
      timeoutMs: 100
    });
    const exit = await run.wait();
    expect(exit.reason).toBe('overall-timeout');
    expect(exit.timedOut).toBe(true);
  }, 15000);

  it('getRecord：starting → running → exited 的状态轨迹', async () => {
    const run = await supervisor.spawn({
      mode: 'child',
      sessionId: 's',
      backendId: 'b',
      argv: [process.execPath, '-e', 'process.exit(0)']
    });
    const running = supervisor.getRecord(run.runId);
    // spawn 返回后已经 running（或者已 exited，Node 很快）
    expect(running?.state === 'running' || running?.state === 'exited').toBe(true);
    await run.wait();
    const after = supervisor.getRecord(run.runId);
    expect(after?.state).toBe('exited');
    expect(after?.exitCode).toBe(0);
  });

  it('cancelScope：同 scopeKey 的 run 一起 cancel', async () => {
    const runA = await supervisor.spawn({
      mode: 'child',
      sessionId: 's',
      backendId: 'b',
      scopeKey: 'scope-x',
      argv: [process.execPath, '-e', 'setInterval(()=>{}, 1000)']
    });
    const runB = await supervisor.spawn({
      mode: 'child',
      sessionId: 's',
      backendId: 'b',
      scopeKey: 'scope-x',
      argv: [process.execPath, '-e', 'setInterval(()=>{}, 1000)']
    });
    const runOther = await supervisor.spawn({
      mode: 'child',
      sessionId: 's',
      backendId: 'b',
      scopeKey: 'scope-y',
      argv: [process.execPath, '-e', 'setTimeout(()=>process.exit(0), 200)']
    });
    await new Promise((r) => setTimeout(r, 50));
    supervisor.cancelScope('scope-x');
    const [exitA, exitB, exitOther] = await Promise.all([runA.wait(), runB.wait(), runOther.wait()]);
    expect(exitA.reason).toBe('manual-cancel');
    expect(exitB.reason).toBe('manual-cancel');
    // scope-y 的进程正常退出
    expect(exitOther.reason).toBe('exit');
    expect(exitOther.exitCode).toBe(0);
  }, 15000);

  it('spawn 空 argv 抛 error', async () => {
    await expect(
      supervisor.spawn({
        mode: 'child',
        sessionId: 's',
        backendId: 'b',
        argv: []
      })
    ).rejects.toThrow(/argv/);
  });

  it('spawn 不存在的命令抛 error', async () => {
    await expect(
      supervisor.spawn({
        mode: 'child',
        sessionId: 's',
        backendId: 'b',
        argv: ['/this/path/does/not/exist/really-nope']
      })
    ).rejects.toBeTruthy();
  });
});
