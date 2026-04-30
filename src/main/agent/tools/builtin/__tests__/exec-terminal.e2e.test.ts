/**
 * exec(terminal=true) 端到端测试
 *
 * 覆盖两条路径：
 *   - @lydell/node-pty 未装 → exec 识别 "Cannot find module" → PTY_UNAVAILABLE
 *   - @lydell/node-pty 已装（用 doMock 伪造）→ 走真实 pty 分支，回读输出 / 退出码
 *
 * pty adapter 内部对 @lydell/node-pty 做了 lazy import + 单例缓存（ptyModulePromise），
 * 所以每个用例都要 vi.resetModules + vi.doMock 重新加载整条链路。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { EventEmitter } from 'node:events';

// ─── 通用 mock ────────────────────────────────────────────
vi.mock('@main/common/env', () => ({
  Env: {
    paths: {
      workspaceRoot: '/mock/workspace',
      userHome: '/mock/home',
      home: '/mock/home-root',
      secretsDir: '/mock/home/secrets'
    },
    main: { logLevel: 'info' }
  }
}));

vi.mock('@main/common/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}));

// ─── Context 工厂 ─────────────────────────────────────────
const cwd = __dirname;

function buildContext(sessionId: string): Record<string, unknown> {
  return {
    mode: 'path-only',
    workspaceRoot: cwd,
    toolPolicy: { allow: [], deny: [], confirm: [] },
    sessionId,
    threadId: sessionId,
    cwd,
    sessionDir: path.join(cwd, '.tmp-sessions', sessionId),
    sessionsDir: path.join(cwd, '.tmp-sessions', sessionId, 'sessions'),
    contextsDir: path.join(cwd, '.tmp-sessions', sessionId),
    eventsDir: path.join(cwd, '.tmp-sessions', sessionId),
    userHome: '/mock/home',
    configDir: '/mock/home/config',
    tempDir: '/tmp',
    agentName: 'test-agent',
    agentMode: 'agent'
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runTool(tool: any, params: Record<string, unknown>, ctx: Record<string, unknown>): Promise<any> {
  const gen = tool.execute(params, undefined, ctx);
  while (true) {
    const { value, done } = await gen.next();
    if (done) return value;
  }
}

// ─── 用例：pty 未装 ───────────────────────────────────────
describe('exec(terminal) — @lydell/node-pty 未安装时返回 PTY_UNAVAILABLE', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // 返回一个空模块（没有 spawn），pty adapter 会抛 "PTY support is unavailable"，
    // exec.ts 的正则 /PTY support is unavailable/i 识别到、回 PTY_UNAVAILABLE。
    // 直接在 factory 里 throw 会被 vitest 包装成 "[vitest] ..." 没法 match 正则。
    vi.doMock('@lydell/node-pty', () => ({}));
  });

  it('识别错误串并返回 PTY_UNAVAILABLE，附友好提示', async () => {
    const { execTool } = await import('../exec');
    const ctx = buildContext('terminal-no-pty');
    const result = await runTool(execTool, { command: 'echo hi', terminal: true }, ctx);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PTY_UNAVAILABLE');
    expect(result.llmContent).toContain('@lydell/node-pty');
    expect(result.metadata?.mode).toBe('terminal');
  });
});

// ─── 用例：pty 已装（伪造）→ 走真实 terminal 分支 ─────────
describe('exec(terminal) — @lydell/node-pty 可用时跑通 pty 分支', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    // 构造一个极简 pty 伪实现：立刻 emit 输出 + 正常退出码 0
    vi.doMock('@lydell/node-pty', () => {
      const spawn = (_file: string, _args: string[] | string, _opts: unknown): unknown => {
        const dataBus = new EventEmitter();
        const exitBus = new EventEmitter();
        let killed = false;

        // 下一轮事件循环再 emit，模拟真实 pty 的异步回调
        setImmediate(() => {
          dataBus.emit('data', 'hello from fake pty\r\n');
          setImmediate(() => {
            if (!killed) {
              exitBus.emit('exit', { exitCode: 0, signal: 0 });
            }
          });
        });

        return {
          pid: 99999,
          write: (_data: string | Buffer): void => {},
          onData: (listener: (v: string) => void) => {
            const handler = (v: string): void => listener(v);
            dataBus.on('data', handler);
            return { dispose: () => dataBus.off('data', handler) };
          },
          onExit: (listener: (e: { exitCode: number; signal?: number }) => void) => {
            const handler = (e: { exitCode: number; signal?: number }): void => listener(e);
            exitBus.on('exit', handler);
            return { dispose: () => exitBus.off('exit', handler) };
          },
          kill: (_sig?: string): void => {
            killed = true;
            setImmediate(() => exitBus.emit('exit', { exitCode: null, signal: 15 }));
          }
        };
      };
      return { spawn, default: { spawn } };
    });
  });

  it('mocked pty 成功路径：拿到 stdout、exitCode=0、mode=terminal、runId 非空', async () => {
    const { execTool } = await import('../exec');
    const ctx = buildContext('terminal-pty-ok');
    const result = await runTool(execTool, { command: 'echo hi', terminal: true }, ctx);

    expect(result.success).toBe(true);
    expect(result.metadata?.mode).toBe('terminal');
    expect(result.metadata?.exitCode).toBe(0);
    expect(typeof result.metadata?.runId).toBe('string');
    expect((result.metadata?.runId as string).length).toBeGreaterThan(0);
    expect(result.metadata?.terminationReason).toBe('exit');
    expect(result.llmContent).toContain('hello from fake pty');
    expect(result.llmContent).toContain('Exit code: 0');
  }, 10_000);

  it('mocked pty + abort signal：外部 abort 后命令走 manual-cancel 分支', async () => {
    // 重置模块 + 重新 mock 一个“不会自己退出”的 pty：只吐数据，等外部 kill
    vi.resetModules();
    vi.doMock('@lydell/node-pty', () => {
      const spawn = (_file: string, _args: string[] | string, _opts: unknown): unknown => {
        const dataBus = new EventEmitter();
        const exitBus = new EventEmitter();
        setImmediate(() => dataBus.emit('data', 'still alive\r\n'));
        return {
          pid: 99998,
          write: (_d: string | Buffer): void => {},
          onData: (listener: (v: string) => void) => {
            const h = (v: string): void => listener(v);
            dataBus.on('data', h);
            return { dispose: () => dataBus.off('data', h) };
          },
          onExit: (listener: (e: { exitCode: number; signal?: number }) => void) => {
            const h = (e: { exitCode: number; signal?: number }): void => listener(e);
            exitBus.on('exit', h);
            return { dispose: () => exitBus.off('exit', h) };
          },
          kill: (_sig?: string): void => {
            setImmediate(() => exitBus.emit('exit', { exitCode: null, signal: 15 }));
          }
        };
      };
      return { spawn, default: { spawn } };
    });
    const { execTool } = await import('../exec');

    const ctx = buildContext('terminal-pty-abort');
    const controller = new AbortController();

    // 在后台 IIFE 里推进 generator，让 exec.ts 内部有机会 signal.addEventListener 挨上
    // 再 await delay + abort，避免“abort 先于 listener 挂上”的竞态
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const consumePromise: Promise<any> = (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gen = (execTool as any).execute(
        { command: 'sleep 10', terminal: true, timeout: 5000 },
        controller.signal,
        ctx
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let last: any;
      while (true) {
        const { value, done } = await gen.next();
        if (done) {
          last = value;
          break;
        }
      }
      return last;
    })();

    // 给到 spawn 完成 + addEventListener 挂上的时间
    await delay(300);
    controller.abort();

    const final = await consumePromise;

    expect(final.success).toBe(false);
    expect(final.error?.code).toBe('ABORTED');
    expect(final.metadata?.terminationReason).toBe('manual-cancel');
  }, 10_000);
});
