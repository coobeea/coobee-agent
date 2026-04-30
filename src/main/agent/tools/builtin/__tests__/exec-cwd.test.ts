/**
 * exec 工具 — cwd 行为测试
 *
 * 目标：验证 exec 工具执行命令时，真正的工作目录由 context.workspaceRoot 决定，
 *      命令里的相对路径（脚本路径 / 脚本参数里的 -o 输出路径 / 脚本内部硬编码的路径）
 *      都会基于该 cwd 解析。
 *
 * 场景 1：workspaceRoot = <__tests__>
 *   - command = `python3 scripts/fixture-write-file.py -o hello.txt -m "..."`
 *   - 期望    : 文件落在 <__tests__>/hello.txt 和 <__tests__>/auto-note.txt
 *
 * 场景 2：workspaceRoot = <__tests__>/data
 *   - command = `python3 ../scripts/fixture-write-file.py -o hello.txt -m "..."`
 *   - 期望    : 文件落在 <__tests__>/data/hello.txt 和 <__tests__>/data/auto-note.txt
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
const dataDir = path.join(testsDir, 'data');

// 场景 1 预期落盘位置（cwd = __tests__）
const outputFileRoot = path.join(testsDir, 'hello.txt');
const extraFileRoot = path.join(testsDir, 'auto-note.txt');

// 场景 2 预期落盘位置（cwd = __tests__/data）
const outputFileInData = path.join(dataDir, 'hello.txt');
const extraFileInData = path.join(dataDir, 'auto-note.txt');

// 场景 3 预期落盘位置（cwd = __tests__/data，-o 带一层子目录）
const subDirInData = path.join(dataDir, 'subdir');
const outputFileInSubDir = path.join(subDirInData, 'hello.txt');

// 场景 4 预期落盘位置（cwd = __tests__/data，-o 填给一个绝对路径）
const absTargetDir = path.join(testsDir, 'abs-target');
const outputFileAbsolute = path.join(absTargetDir, 'hello.txt');

// 场景 5 预期落盘位置（cwd = __tests__/data，-o 用 .. 跳到父级）
const outsideFile = path.join(testsDir, 'outside.txt');

const EXTRA_MESSAGE = 'This note is created automatically by fixture-write-file.py';

/** 构造一个以指定 workspaceRoot 为 cwd 的 ToolExecutionContext */
function buildContext(workspaceRoot: string): Record<string, unknown> {
  const sessionId = 'exec-cwd-test';
  return {
    mode: 'path-only',
    workspaceRoot,
    toolPolicy: { allow: [], deny: [], confirm: [] },

    sessionId,
    threadId: sessionId,

    cwd: workspaceRoot,
    sessionDir: path.join(workspaceRoot, '.tmp-sessions', sessionId),
    sessionsDir: path.join(workspaceRoot, '.tmp-sessions', sessionId, 'sessions'),
    contextsDir: path.join(workspaceRoot, '.tmp-sessions', sessionId),
    eventsDir: path.join(workspaceRoot, '.tmp-sessions', sessionId),

    userHome: '/mock/home',
    configDir: '/mock/home/config',
    tempDir: '/tmp',

    agentName: 'test-agent',
    agentMode: 'agent'
  };
}

/** 跑 exec，消耗完所有 yield，拿到最终 ToolResult */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runExec(tool: any, command: string, workspaceRoot: string): Promise<any> {
  const gen = tool.execute({ command }, undefined, buildContext(workspaceRoot));
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
    // 注意：暂时不清理生成的文件，方便人工查看实际落盘位置。
    // 脚本是覆盖写，重跑也不会冲突。
  });

  it('fixture script exists under scripts/', () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
  });

  it('runs python script with relative paths based on workspaceRoot', async () => {
    const message = 'hello from __tests__ cwd';
    const result = await runExec(
      execTool,
      `python3 scripts/fixture-write-file.py -o hello.txt -m "${message}"`,
      testsDir
    );

    // 1. 命令执行成功
    expect(result.success).toBe(true);
    expect(result.metadata?.exitCode).toBe(0);

    // 2. 工具实际使用的 cwd 就是我们传入的 workspaceRoot
    expect(result.metadata?.cwd).toBe(testsDir);

    // 3. stdout 里能看到脚本固定打印的 WROTE 和 EXTRA 两行
    expect(result.llmContent).toContain('WROTE');
    expect(result.llmContent).toContain('EXTRA');

    // 4. 主文件（命令行参数驱动）写到 __tests__/hello.txt
    expect(fs.existsSync(outputFileRoot)).toBe(true);
    expect(fs.readFileSync(outputFileRoot, 'utf-8')).toBe(message);

    // 5. 附加文件（脚本硬编码创建）也落在 cwd 根下
    expect(fs.existsSync(extraFileRoot)).toBe(true);
    expect(fs.readFileSync(extraFileRoot, 'utf-8')).toBe(EXTRA_MESSAGE);
  });
});

describe('exec tool — cwd resolves against workspaceRoot (__tests__/data)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let execTool: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../exec');
    execTool = mod.execTool;
    // 暂时不清理生成文件，方便人工查看落盘位置。
  });

  it('data/ dir exists', () => {
    expect(fs.existsSync(dataDir)).toBe(true);
  });

  it('runs python script via ../scripts/... with cwd pointing at data/', async () => {
    const message = 'hello from __tests__/data cwd';
    const result = await runExec(
      execTool,
      `python3 ../scripts/fixture-write-file.py -o hello.txt -m "${message}"`,
      dataDir
    );

    // 1. 命令执行成功
    expect(result.success).toBe(true);
    expect(result.metadata?.exitCode).toBe(0);

    // 2. 工具实际使用的 cwd 是 dataDir
    expect(result.metadata?.cwd).toBe(dataDir);

    // 3. stdout 同样拿到 WROTE + EXTRA 两条
    expect(result.llmContent).toContain('WROTE');
    expect(result.llmContent).toContain('EXTRA');

    // 4. 主文件 hello.txt 落在 __tests__/data/hello.txt
    expect(fs.existsSync(outputFileInData)).toBe(true);
    expect(fs.readFileSync(outputFileInData, 'utf-8')).toBe(message);

    // 5. 附加文件 auto-note.txt 也落在 __tests__/data/auto-note.txt
    expect(fs.existsSync(extraFileInData)).toBe(true);
    expect(fs.readFileSync(extraFileInData, 'utf-8')).toBe(EXTRA_MESSAGE);
  });

  it('resolves -o relative path with an extra directory layer (subdir/hello.txt)', async () => {
    const message = 'hello from __tests__/data cwd with subdir prefix';
    const result = await runExec(
      execTool,
      `python3 ../scripts/fixture-write-file.py -o subdir/hello.txt -m "${message}"`,
      dataDir
    );

    // 1. 命令执行成功
    expect(result.success).toBe(true);
    expect(result.metadata?.exitCode).toBe(0);

    // 2. cwd 仍然是 dataDir（没因为参数里有 subdir 而改变）
    expect(result.metadata?.cwd).toBe(dataDir);

    expect(result.llmContent).toContain('WROTE');
    expect(result.llmContent).toContain('EXTRA');

    // 3. 主文件：-o 多一层目录前缀，写到 __tests__/data/subdir/hello.txt
    //    脚本里 Path.parent.mkdir(parents=True, exist_ok=True) 自动建中间目录
    expect(fs.existsSync(subDirInData)).toBe(true);
    expect(fs.existsSync(outputFileInSubDir)).toBe(true);
    expect(fs.readFileSync(outputFileInSubDir, 'utf-8')).toBe(message);

    // 4. 附加文件仍然落在 cwd 根下 __tests__/data/auto-note.txt，不跟着 subdir 走
    //    这证明脚本内部硬编码的相对路径也是基于 cwd 解析，与 -o 参数无关
    expect(fs.existsSync(extraFileInData)).toBe(true);
    expect(fs.readFileSync(extraFileInData, 'utf-8')).toBe(EXTRA_MESSAGE);
  });

  it('accepts absolute -o path, bypassing cwd while extra file still respects cwd', async () => {
    const message = 'hello from absolute -o path';
    const result = await runExec(
      execTool,
      `python3 ../scripts/fixture-write-file.py -o ${outputFileAbsolute} -m "${message}"`,
      dataDir
    );

    // 1. 命令执行成功
    expect(result.success).toBe(true);
    expect(result.metadata?.exitCode).toBe(0);

    // 2. cwd 仍然是 dataDir（绝对路径只影响了落盘位置，不改变子进程的工作目录）
    expect(result.metadata?.cwd).toBe(dataDir);

    expect(result.llmContent).toContain('WROTE');
    expect(result.llmContent).toContain('EXTRA');

    // 3. 主文件：绝对路径跳出 cwd，落在 __tests__/abs-target/hello.txt
    //    脚本里 Path.parent.mkdir(parents=True, exist_ok=True) 自动建 abs-target/
    expect(fs.existsSync(absTargetDir)).toBe(true);
    expect(fs.existsSync(outputFileAbsolute)).toBe(true);
    expect(fs.readFileSync(outputFileAbsolute, 'utf-8')).toBe(message);

    // 4. 附加文件 auto-note.txt 仍然基于 cwd 解析，落在 __tests__/data/auto-note.txt
    //    这证明：-o 用绝对路径只影响了“脚本里用 args.output 写的那个文件”，
    //    而脚本硬编码的 Path("auto-note.txt") 依然走 cwd
    expect(fs.existsSync(extraFileInData)).toBe(true);
    expect(fs.readFileSync(extraFileInData, 'utf-8')).toBe(EXTRA_MESSAGE);
  });

  it('resolves -o with .. (parent hop), file lands outside cwd', async () => {
    const message = 'hello from parent hop via ..';
    const result = await runExec(
      execTool,
      `python3 ../scripts/fixture-write-file.py -o ../outside.txt -m "${message}"`,
      dataDir
    );

    // 1. 命令执行成功
    expect(result.success).toBe(true);
    expect(result.metadata?.exitCode).toBe(0);

    // 2. cwd 还是 dataDir（.. 只是路径字面量，不改变子进程的工作目录）
    expect(result.metadata?.cwd).toBe(dataDir);

    expect(result.llmContent).toContain('WROTE');
    expect(result.llmContent).toContain('EXTRA');

    // 3. 主文件：../outside.txt 基于 cwd 解析 → __tests__/outside.txt
    //    这里确实跳出了 cwd，落在 dataDir 的上一层 __tests__ 根下
    expect(fs.existsSync(outsideFile)).toBe(true);
    expect(fs.readFileSync(outsideFile, 'utf-8')).toBe(message);
    expect(path.dirname(outsideFile)).toBe(testsDir);

    // 4. 附加文件 auto-note.txt 仍然落在 cwd 根下 __tests__/data/auto-note.txt
    //    脚本硬编码路径没有 ..，纯相对 cwd
    expect(fs.existsSync(extraFileInData)).toBe(true);
    expect(fs.readFileSync(extraFileInData, 'utf-8')).toBe(EXTRA_MESSAGE);
  });
});
