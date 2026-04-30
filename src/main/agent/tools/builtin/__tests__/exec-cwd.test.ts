/**
 * exec 工具 — cwd 行为测试（场景 1：workspaceRoot 指向 __tests__）
 *
 * 目标：验证 exec 工具在执行命令时，真正的工作目录由 context.workspaceRoot 决定，
 *      命令里的相对路径（脚本路径 / 脚本参数里的 -o 输出路径）都会基于该 cwd 解析。
 *
 * 场景：
 *   - workspaceRoot = <__tests__>
 *   - command       = `python3 scripts/fixture-write-file.py -o data/hello.txt -m "..."`
 *   - 期望          : 文件最终写在 <__tests__>/data/hello.txt
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';

// ─── Mocks ────────────────────────────────────────────────
// Env 和 logger 通过 @main 别名被间接 import（sensitive-paths / exec-policy），
// 这里 mock 成可控常量，避免依赖真实 Electron app 初始化。
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

// ─── Fixtures ─────────────────────────────────────────────
const testsDir = __dirname; // <...>/src/main/agent/tools/builtin/__tests__
const scriptPath = path.join(testsDir, 'scripts', 'fixture-write-file.py');
// 主输出文件：由命令行参数 -o 指定的相对路径，直接落在 cwd 根下
const outputFile = path.join(testsDir, 'hello.txt');
// 附加文件：脚本硬编码创建的 auto-note.txt，也落在 cwd 根下
const extraFile = path.join(testsDir, 'auto-note.txt');
const EXTRA_MESSAGE = 'This note is created automatically by fixture-write-file.py';

/** 构造一个指向 __tests__ 的 ToolExecutionContext */
function buildContext(): Record<string, unknown> {
  const sessionId = 'exec-cwd-test';
  return {
    mode: 'path-only',
    workspaceRoot: testsDir,
    toolPolicy: { allow: [], deny: [], confirm: [] },

    sessionId,
    threadId: sessionId,

    cwd: testsDir,
    sessionDir: path.join(testsDir, '.tmp-sessions', sessionId),
    sessionsDir: path.join(testsDir, '.tmp-sessions', sessionId, 'sessions'),
    contextsDir: path.join(testsDir, '.tmp-sessions', sessionId),
    eventsDir: path.join(testsDir, '.tmp-sessions', sessionId),

    userHome: '/mock/home',
    configDir: '/mock/home/config',
    tempDir: '/tmp',

    agentName: 'test-agent',
    agentMode: 'agent'
  };
}

/** 跑 exec，消耗完所有 yield，拿到最终 ToolResult */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runExec(tool: any, command: string): Promise<any> {
  const gen = tool.execute({ command }, undefined, buildContext());
  while (true) {
    const { value, done } = await gen.next();
    if (done) return value;
  }
}

// ─── Tests ────────────────────────────────────────────────
describe('exec tool — cwd resolves against workspaceRoot (__tests__)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let execTool: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../exec');
    execTool = mod.execTool;
    if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
    if (fs.existsSync(extraFile)) fs.unlinkSync(extraFile);
  });

  afterEach(() => {
    if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
    if (fs.existsSync(extraFile)) fs.unlinkSync(extraFile);
  });

  it('fixture script exists under scripts/', () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
  });

  it('runs python script with relative paths based on workspaceRoot', async () => {
    const message = 'hello from __tests__ cwd';
    const result = await runExec(execTool, `python3 scripts/fixture-write-file.py -o hello.txt -m "${message}"`);

    // 1. 命令执行成功
    expect(result.success).toBe(true);
    expect(result.metadata?.exitCode).toBe(0);

    // 2. 工具实际使用的 cwd 就是我们传入的 workspaceRoot
    expect(result.metadata?.cwd).toBe(testsDir);

    // 3. stdout 里能看到脚本固定打印的 WROTE 和 EXTRA 两行
    expect(result.llmContent).toContain('WROTE');
    expect(result.llmContent).toContain('EXTRA');

    // 4. 主文件（命令行参数驱动）写到 __tests__/hello.txt
    expect(fs.existsSync(outputFile)).toBe(true);
    expect(fs.readFileSync(outputFile, 'utf-8')).toBe(message);

    // 5. 附加文件（脚本硬编码创建）也落在 cwd 根下
    expect(fs.existsSync(extraFile)).toBe(true);
    expect(fs.readFileSync(extraFile, 'utf-8')).toBe(EXTRA_MESSAGE);
  });
});
