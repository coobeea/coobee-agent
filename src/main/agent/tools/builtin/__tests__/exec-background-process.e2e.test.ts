/**
 * exec(background=true) + process 工具的端到端集成测试
 *
 * 覆盖链路：
 *   exec(background) → supervisor.spawn(child) → background-store 登记
 *   process(list)    → 能看到会话里的 runId
 *   process(read)    → 能读到 stdout（tick-XXX）
 *   process(write)   → 把 stdin 数据送进去，再 read 看到 echo
 *   process(kill)    → 进程被杀，再 read 时 state=exited
 *
 * 注意：
 *   - 全程使用 `process.execPath` + `-e` 启动真实 Node 子进程，不依赖 python/bash
 *   - mock 掉 @main/common/env + logger，避免拉起 Electron app
 *   - background-store 是单例，每个用例用独立 sessionId 做隔离
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// ─── Mocks ────────────────────────────────────────────────
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
/** 这个 cwd 不重要，只要是个真实存在的目录就行 */
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

/** 跑任意工具，消耗完所有 yield，返回最终 ToolResult */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runTool(tool: any, params: Record<string, unknown>, ctx: Record<string, unknown>): Promise<any> {
  const gen = tool.execute(params, undefined, ctx);
  while (true) {
    const { value, done } = await gen.next();
    if (done) return value;
  }
}

// ─── Tests ────────────────────────────────────────────────
describe('exec(background) + process 工具端到端链路', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let execTool: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let processTool: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let store: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const execMod = await import('../exec');
    const processMod = await import('../process');
    const procSys = await import('../../../process');
    execTool = execMod.execTool;
    processTool = processMod.processTool;
    store = procSys.getBackgroundStore();
  });

  afterEach(async () => {
    // 清理 store，避免用例间互相污染
    try {
      store.clear();
    } catch {
      // ignore
    }
    // 给事件循环一帧，让尚未结算的 exit 回调完成
    await delay(50);
  });

  it('启动一个长驻 Node 进程 → list/read/kill 闭环', async () => {
    const sessionId = 'bg-e2e-1';
    const ctx = buildContext(sessionId);

    // 1. 启动一个每 100ms 打印 tick 的长驻进程
    const bgScript = "let i=0; setInterval(()=>{console.log('tick-' + (++i))}, 100); setInterval(()=>{}, 10000);";
    const command = `"${process.execPath}" -e "${bgScript.replace(/"/g, '\\"')}"`;

    const execResult = await runTool(execTool, { command, background: true }, ctx);

    expect(execResult.success).toBe(true);
    expect(execResult.metadata?.mode).toBe('background');
    const runId = execResult.metadata?.runId as string;
    expect(typeof runId).toBe('string');
    expect(runId.length).toBeGreaterThan(0);
    expect(execResult.llmContent).toContain(runId);

    // 2. 等一会让 stdout 有内容
    await delay(400);

    // 3. list 应该能看到这个 runId
    const listResult = await runTool(processTool, { action: 'list' }, ctx);
    expect(listResult.success).toBe(true);
    expect(listResult.llmContent).toContain(runId);
    expect(listResult.llmContent).toContain('state: running');
    expect(listResult.metadata?.total).toBe(1);
    expect(listResult.metadata?.runningCount).toBe(1);
    expect(listResult.metadata?.exitedCount).toBe(0);
    expect(listResult.metadata?.returnedCount).toBe(1);
    // 头部统计行
    expect(listResult.llmContent).toMatch(/1 running, 0 exited, 1 total/);

    // 4. read 能拿到 tick 输出
    const read1 = await runTool(processTool, { action: 'read', processId: runId }, ctx);
    expect(read1.success).toBe(true);
    expect(read1.metadata?.state).toBe('running');
    expect(read1.llmContent).toContain('tick-');
    expect(read1.llmContent).toContain('--- stdout ---');

    // 5. kill 应该成功
    const killResult = await runTool(processTool, { action: 'kill', processId: runId }, ctx);
    expect(killResult.success).toBe(true);
    expect(killResult.metadata?.killed).toBe(true);

    // 6. 等 run.wait() 结算
    await delay(300);

    // 7. 再 read，state 应该是 exited
    const read2 = await runTool(processTool, { action: 'read', processId: runId }, ctx);
    expect(read2.success).toBe(true);
    expect(read2.metadata?.state).toBe('exited');
    expect(read2.llmContent).toContain('state: exited');

    // 8. 对已退出的进程再 kill，应该幂等成功
    const killAgain = await runTool(processTool, { action: 'kill', processId: runId }, ctx);
    expect(killAgain.success).toBe(true);
    expect(killAgain.metadata?.alreadyExited).toBe(true);
  }, 15_000);

  it('process(write) 向 stdin 写入 → read 看到 echo', async () => {
    const sessionId = 'bg-e2e-write';
    const ctx = buildContext(sessionId);

    // 读 stdin 行，每行 echo 一句
    const bgScript =
      "process.stdin.setEncoding('utf8');" +
      "let buf='';" +
      "process.stdin.on('data', d => {" +
      '  buf += d;' +
      '  let idx;' +
      "  while ((idx = buf.indexOf('\\n')) >= 0) {" +
      '    const line = buf.slice(0, idx);' +
      '    buf = buf.slice(idx+1);' +
      "    console.log('got:' + line);" +
      '  }' +
      '});' +
      'process.stdin.resume();' +
      'setInterval(()=>{}, 10000);';
    const command = `"${process.execPath}" -e "${bgScript.replace(/"/g, '\\"')}"`;

    const execResult = await runTool(execTool, { command, background: true }, ctx);
    expect(execResult.success).toBe(true);
    const runId = execResult.metadata?.runId as string;

    // 让子进程 ready
    await delay(200);

    // write 一行
    const writeResult = await runTool(processTool, { action: 'write', processId: runId, data: 'hello\n' }, ctx);
    expect(writeResult.success).toBe(true);
    expect(writeResult.metadata?.bytesWritten).toBe(Buffer.byteLength('hello\n', 'utf-8'));

    // 等 echo 回来
    await delay(300);

    // read 应该看到 "got:hello"
    const readResult = await runTool(processTool, { action: 'read', processId: runId }, ctx);
    expect(readResult.success).toBe(true);
    expect(readResult.llmContent).toContain('got:hello');

    // 清理
    await runTool(processTool, { action: 'kill', processId: runId }, ctx);
    await delay(200);
  }, 15_000);

  it('空会话 list → 提示没有后台进程', async () => {
    const sessionId = 'bg-e2e-empty';
    const ctx = buildContext(sessionId);

    const result = await runTool(processTool, { action: 'list' }, ctx);
    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('No background processes');
  });

  it('read/write/kill 针对不存在的 runId → PROCESS_NOT_FOUND', async () => {
    const sessionId = 'bg-e2e-missing';
    const ctx = buildContext(sessionId);
    const fakeId = 'non-existent-run-id-xyz';

    const readMiss = await runTool(processTool, { action: 'read', processId: fakeId }, ctx);
    expect(readMiss.success).toBe(false);
    expect(readMiss.error?.code).toBe('PROCESS_NOT_FOUND');

    const writeMiss = await runTool(processTool, { action: 'write', processId: fakeId, data: 'x' }, ctx);
    expect(writeMiss.success).toBe(false);
    expect(writeMiss.error?.code).toBe('PROCESS_NOT_FOUND');

    const killMiss = await runTool(processTool, { action: 'kill', processId: fakeId }, ctx);
    expect(killMiss.success).toBe(false);
    expect(killMiss.error?.code).toBe('PROCESS_NOT_FOUND');
  });

  it('read/write/kill 缺 processId → INVALID_PARAM', async () => {
    const ctx = buildContext('bg-e2e-invalid');

    const readNoId = await runTool(processTool, { action: 'read' }, ctx);
    expect(readNoId.success).toBe(false);
    expect(readNoId.error?.code).toBe('INVALID_PARAM');

    const writeNoId = await runTool(processTool, { action: 'write', data: 'x' }, ctx);
    expect(writeNoId.success).toBe(false);
    expect(writeNoId.error?.code).toBe('INVALID_PARAM');

    const writeNoData = await runTool(processTool, { action: 'write', processId: 'x' }, ctx);
    expect(writeNoData.success).toBe(false);
    expect(writeNoData.error?.code).toBe('INVALID_PARAM');

    const killNoId = await runTool(processTool, { action: 'kill' }, ctx);
    expect(killNoId.success).toBe(false);
    expect(killNoId.error?.code).toBe('INVALID_PARAM');
  });

  it('process(wait) 阻塞等到进程自然退出，返 status=exited + exitCode=0', async () => {
    const sessionId = 'bg-e2e-wait-ok';
    const ctx = buildContext(sessionId);

    // 跑 500ms 后进程正常退出
    const bgScript = "console.log('before-exit'); setTimeout(()=>process.exit(0), 500);";
    const command = `"${process.execPath}" -e "${bgScript.replace(/"/g, '\\"')}"`;

    const execResult = await runTool(execTool, { command, background: true }, ctx);
    expect(execResult.success).toBe(true);
    const runId = execResult.metadata?.runId as string;

    // wait 阻塞至退出（给充裕的 timeout）
    const waitResult = await runTool(processTool, { action: 'wait', processId: runId, timeoutMs: 5000 }, ctx);
    expect(waitResult.success).toBe(true);
    expect(waitResult.metadata?.waitStatus).toBe('exited');
    expect(waitResult.metadata?.state).toBe('exited');
    expect(waitResult.metadata?.exitCode).toBe(0);
    expect(waitResult.metadata?.terminationReason).toBe('exit');
    expect(waitResult.llmContent).toContain('before-exit');
    expect(waitResult.llmContent).toContain('state: exited');
  }, 15_000);

  it('process(wait) timeoutMs 内进程没退出 → status=timeout，进程仍可 kill', async () => {
    const sessionId = 'bg-e2e-wait-timeout';
    const ctx = buildContext(sessionId);

    // 永远不退出
    const bgScript = "console.log('still running'); setInterval(()=>{}, 10000);";
    const command = `"${process.execPath}" -e "${bgScript.replace(/"/g, '\\"')}"`;

    const execResult = await runTool(execTool, { command, background: true }, ctx);
    expect(execResult.success).toBe(true);
    const runId = execResult.metadata?.runId as string;

    // wait 小超时
    const waitResult = await runTool(processTool, { action: 'wait', processId: runId, timeoutMs: 200 }, ctx);
    expect(waitResult.success).toBe(false);
    expect(waitResult.error?.code).toBe('WAIT_TIMEOUT');
    expect(waitResult.metadata?.waitStatus).toBe('timeout');
    expect(waitResult.metadata?.state).toBe('running');
    expect(waitResult.llmContent).toContain('Wait timed out');

    // kill 清理
    const killResult = await runTool(processTool, { action: 'kill', processId: runId }, ctx);
    expect(killResult.success).toBe(true);

    // 验证 kill 后 wait 立刻返 exited
    await delay(200);
    const waitAfterKill = await runTool(processTool, { action: 'wait', processId: runId, timeoutMs: 2000 }, ctx);
    expect(waitAfterKill.success).toBe(true);
    expect(waitAfterKill.metadata?.waitStatus).toBe('exited');
    expect(waitAfterKill.metadata?.state).toBe('exited');
  }, 15_000);

  it('process(wait) 不存在的 runId → PROCESS_NOT_FOUND', async () => {
    const ctx = buildContext('bg-e2e-wait-missing');
    const result = await runTool(processTool, { action: 'wait', processId: 'no-such-run', timeoutMs: 100 }, ctx);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PROCESS_NOT_FOUND');
  });

  it('process(wait) 缺 processId → INVALID_PARAM', async () => {
    const ctx = buildContext('bg-e2e-wait-noid');
    const result = await runTool(processTool, { action: 'wait' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PARAM');
  });

  it('list 统计 metadata：A(running) + B(exited) 混合场景的 runningCount/exitedCount', async () => {
    const sessionId = 'bg-e2e-stats';
    const ctx = buildContext(sessionId);

    // A: 长驻
    const longScript = "setInterval(()=>{console.log('.')}, 500); setInterval(()=>{}, 10000);";
    const longCmd = `"${process.execPath}" -e "${longScript.replace(/"/g, '\\"')}"`;
    const execA = await runTool(execTool, { command: longCmd, background: true }, ctx);
    expect(execA.success).toBe(true);
    const runIdA = execA.metadata?.runId as string;

    // B: 短命的，很快自己 exit(0)
    const shortScript = "console.log('done'); process.exit(0);";
    const shortCmd = `"${process.execPath}" -e "${shortScript.replace(/"/g, '\\"')}"`;
    const execB = await runTool(execTool, { command: shortCmd, background: true }, ctx);
    expect(execB.success).toBe(true);
    const runIdB = execB.metadata?.runId as string;

    // 等 B 退出
    await runTool(processTool, { action: 'wait', processId: runIdB, timeoutMs: 3000 }, ctx);

    // list 全部
    const listAll = await runTool(processTool, { action: 'list' }, ctx);
    expect(listAll.success).toBe(true);
    expect(listAll.metadata?.total).toBe(2);
    expect(listAll.metadata?.runningCount).toBe(1);
    expect(listAll.metadata?.exitedCount).toBe(1);
    expect(listAll.metadata?.returnedCount).toBe(2);
    expect(listAll.metadata?.stateFilter).toBeUndefined();
    expect(listAll.llmContent).toContain(runIdA);
    expect(listAll.llmContent).toContain(runIdB);

    // list running 过滤
    const listRun = await runTool(processTool, { action: 'list', state: 'running' }, ctx);
    expect(listRun.metadata?.runningCount).toBe(1);
    expect(listRun.metadata?.exitedCount).toBe(1);
    expect(listRun.metadata?.returnedCount).toBe(1);
    expect(listRun.metadata?.stateFilter).toBe('running');
    expect(listRun.llmContent).toContain(runIdA);
    expect(listRun.llmContent).not.toContain(runIdB);

    // list exited 过滤
    const listExit = await runTool(processTool, { action: 'list', state: 'exited' }, ctx);
    expect(listExit.metadata?.returnedCount).toBe(1);
    expect(listExit.metadata?.stateFilter).toBe('exited');
    expect(listExit.llmContent).toContain(runIdB);
    expect(listExit.llmContent).not.toContain(runIdA);

    // 清理
    await runTool(processTool, { action: 'kill', processId: runIdA }, ctx);
    await delay(200);
  }, 15_000);

  it('process(remove) 已退出的 entry 可以删除，删后 list 不再有它', async () => {
    const sessionId = 'bg-e2e-remove-ok';
    const ctx = buildContext(sessionId);

    const bgScript = "console.log('bye'); process.exit(0);";
    const command = `"${process.execPath}" -e "${bgScript.replace(/"/g, '\\"')}"`;
    const execResult = await runTool(execTool, { command, background: true }, ctx);
    expect(execResult.success).toBe(true);
    const runId = execResult.metadata?.runId as string;

    // 等退出
    const waitResult = await runTool(processTool, { action: 'wait', processId: runId, timeoutMs: 3000 }, ctx);
    expect(waitResult.metadata?.state).toBe('exited');

    // remove 成功
    const removeResult = await runTool(processTool, { action: 'remove', processId: runId }, ctx);
    expect(removeResult.success).toBe(true);
    expect(removeResult.metadata?.removed).toBe(true);
    expect(removeResult.llmContent).toContain('Removed entry');

    // 再 read 应该 PROCESS_NOT_FOUND
    const readAfter = await runTool(processTool, { action: 'read', processId: runId }, ctx);
    expect(readAfter.success).toBe(false);
    expect(readAfter.error?.code).toBe('PROCESS_NOT_FOUND');

    // list 里也看不到它
    const listAfter = await runTool(processTool, { action: 'list' }, ctx);
    expect(listAfter.metadata?.total).toBe(0);
    expect(listAfter.llmContent).not.toContain(runId);
  }, 15_000);

  it('process(remove) 对还在 running 的进程 → PROCESS_STILL_RUNNING，kill 后可 remove', async () => {
    const sessionId = 'bg-e2e-remove-running';
    const ctx = buildContext(sessionId);

    const bgScript = 'setInterval(()=>{}, 10000);';
    const command = `"${process.execPath}" -e "${bgScript.replace(/"/g, '\\"')}"`;
    const execResult = await runTool(execTool, { command, background: true }, ctx);
    expect(execResult.success).toBe(true);
    const runId = execResult.metadata?.runId as string;

    // 直接 remove 还在 running 的 → 报错
    const removeBusy = await runTool(processTool, { action: 'remove', processId: runId }, ctx);
    expect(removeBusy.success).toBe(false);
    expect(removeBusy.error?.code).toBe('PROCESS_STILL_RUNNING');
    expect(removeBusy.metadata?.state).toBe('running');

    // kill 后再 remove
    await runTool(processTool, { action: 'kill', processId: runId }, ctx);
    await delay(300);
    const removeNow = await runTool(processTool, { action: 'remove', processId: runId }, ctx);
    expect(removeNow.success).toBe(true);
    expect(removeNow.metadata?.removed).toBe(true);
  }, 15_000);

  it('process(remove) 不存在的 runId → PROCESS_NOT_FOUND；缺 processId → INVALID_PARAM', async () => {
    const ctx = buildContext('bg-e2e-remove-err');

    const miss = await runTool(processTool, { action: 'remove', processId: 'no-such-id' }, ctx);
    expect(miss.success).toBe(false);
    expect(miss.error?.code).toBe('PROCESS_NOT_FOUND');

    const noId = await runTool(processTool, { action: 'remove' }, ctx);
    expect(noId.success).toBe(false);
    expect(noId.error?.code).toBe('INVALID_PARAM');
  });

  it('list 按 sessionId 隔离：A 会话的进程不会出现在 B 会话的 list 里', async () => {
    const ctxA = buildContext('bg-e2e-sessA');
    const ctxB = buildContext('bg-e2e-sessB');

    const bgScript = "setInterval(()=>{console.log('.')}, 500); setInterval(()=>{}, 10000);";
    const command = `"${process.execPath}" -e "${bgScript.replace(/"/g, '\\"')}"`;

    const execA = await runTool(execTool, { command, background: true }, ctxA);
    expect(execA.success).toBe(true);
    const runIdA = execA.metadata?.runId as string;

    await delay(100);

    const listA = await runTool(processTool, { action: 'list' }, ctxA);
    expect(listA.llmContent).toContain(runIdA);

    const listB = await runTool(processTool, { action: 'list' }, ctxB);
    expect(listB.llmContent).not.toContain(runIdA);
    expect(listB.llmContent).toContain('No background processes');

    // 清理
    await runTool(processTool, { action: 'kill', processId: runIdA }, ctxA);
    await delay(200);
  }, 10_000);
});
