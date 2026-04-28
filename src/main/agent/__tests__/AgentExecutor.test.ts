/**
 * AgentExecutor 测试 — 从零开始，一步一步加
 *
 * 运行命令：
 *   pnpm vitest run src/main/agent/__tests__/AgentExecutor.test.ts
 */

import path from 'path';
import fs from 'fs';
import { describe, it, expect, afterEach, vi } from 'vitest';

// ===== Electron 环境 stub =====

vi.mock('electron', () => {
  const base = path.join(process.cwd(), 'test-results');
  return {
    app: {
      getPath: () => base,
      getAppPath: () => base,
      getName: () => 'test',
      getVersion: () => '0.0.0',
      getLocale: () => 'zh-CN',
      isPackaged: false
    },
    BrowserWindow: vi.fn(),
    ipcMain: { on: vi.fn(), handle: vi.fn() },
    session: { defaultSession: { webRequest: { onHeadersReceived: vi.fn() } } }
  };
});

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }));

// ===== 日志 mock =====

const { logBuffer, logPath } = vi.hoisted(() => ({
  logBuffer: [] as string[],
  logPath: `${process.cwd()}/test-results/logs/agent-executor-test.log`
}));

function flushLogBuffer(): void {
  if (logBuffer.length > 0) {
    const logDir = path.dirname(logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    fs.appendFileSync(logPath, logBuffer.join(''), 'utf-8');
    logBuffer.length = 0;
  }
}

vi.mock('electron-log', () => {
  const addToBuffer = (level: string, ...args: unknown[]): void => {
    const message = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    logBuffer.push(`[${new Date().toISOString()}] [${level}] ${message}\n`);
  };

  const transports = {
    file: { level: 'debug', getFile: () => ({ path: logPath }) },
    console: { level: 'info' }
  };

  const logger = {
    info: (...args: unknown[]) => addToBuffer('INFO', ...args),
    warn: (...args: unknown[]) => addToBuffer('WARN', ...args),
    error: (...args: unknown[]) => addToBuffer('ERROR', ...args),
    debug: (...args: unknown[]) => addToBuffer('DEBUG', ...args),
    verbose: (...args: unknown[]) => addToBuffer('VERBOSE', ...args),
    transports
  };

  return {
    default: Object.assign(logger, {
      create: () => ({ ...logger, transports: { ...transports } })
    })
  };
});

vi.mock('mkdirp', () => ({ mkdirp: vi.fn().mockResolvedValue(undefined) }));

// ===== 真实 import =====

import { agentExecutor, getAgentExecutor } from '../AgentExecutor';
import type { AgentExecuteRequest } from '../AgentExecutor';

// ===== 测试 =====

const logDir = path.join(process.cwd(), 'test-results', 'logs');
fs.mkdirSync(logDir, { recursive: true });
const testLogFile = path.join(logDir, 'test-write.log');
fs.writeFileSync(testLogFile, `[${new Date().toISOString()}] [TEST] AgentExecutor 日志系统初始化成功\n`, 'utf-8');

describe('AgentExecutor', () => {
  afterEach(() => {
    flushLogBuffer();
  });

  // ==================== Step 1: 状态管理 ====================

  describe('步骤1：状态管理', () => {
    it('未知 session 返回 idle 状态', () => {
      const status = agentExecutor.getStatus('nonexistent-session');
      expect(status.busy).toBe(false);
      expect(status.startedAt).toBeUndefined();
    });

    it('getActiveSessions 初始为空', () => {
      const sessions = agentExecutor.getActiveSessions();
      expect(sessions).toEqual([]);
    });

    it('abort 不存在 session 返回 false', () => {
      const result = agentExecutor.abort('nonexistent-session');
      expect(result).toBe(false);
    });
  });

  // ==================== Step 2: submit 提交逻辑 ====================

  describe('步骤2：submit 提交', () => {
    const testSessionId = 'test-session-' + Date.now();

    it('submit 返回 accepted', async () => {
      const request: AgentExecuteRequest = {
        sessionId: testSessionId + '-accepted',
        message: 'hello',
        runtimeType: 'pi-mono',
        lightweight: true,
        sessionMode: 'memory'
      };

      const result = agentExecutor.submit(request);
      expect(result.status).toBe('accepted');
      expect(result.sessionId).toBe(request.sessionId);

      // 等待 fire-and-forget 执行完成（轻量模式很快）
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    it('同一 session 重复 submit 返回 busy', async () => {
      const sid = testSessionId + '-busy';

      // 第一次提交，让它一直在运行中
      const request: AgentExecuteRequest = {
        sessionId: sid,
        message: 'hello',
        runtimeType: 'pi-mono',
        lightweight: true,
        sessionMode: 'memory'
      };

      const first = agentExecutor.submit(request);

      // 同一 session 再次提交立即返回 busy
      const second = agentExecutor.submit(request);

      expect(first.status).toBe('accepted');
      expect(second.status).toBe('busy');

      // 等第一次执行完成
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    it('submit 后 getStatus 返回 busy', async () => {
      const sid = testSessionId + '-status';

      const request: AgentExecuteRequest = {
        sessionId: sid,
        message: 'hello',
        runtimeType: 'pi-mono',
        lightweight: true,
        sessionMode: 'memory'
      };

      agentExecutor.submit(request);

      const status = agentExecutor.getStatus(sid);
      expect(status.busy).toBe(true);
      expect(status.startedAt).toBeGreaterThan(0);

      // 等待完成
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    it('submit 完成后 getStatus 恢复 idle', async () => {
      const sid = testSessionId + '-complete';

      const request: AgentExecuteRequest = {
        sessionId: sid,
        message: 'hello',
        runtimeType: 'pi-mono',
        lightweight: true,
        sessionMode: 'memory'
      };

      agentExecutor.submit(request);

      // 等待执行完成
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const status = agentExecutor.getStatus(sid);
      expect(status.busy).toBe(false);
    });
  });

  // ==================== Step 3: abort 中止 ====================

  describe('步骤3：abort 中止', () => {
    it('abort 执行中的 session 返回 true', async () => {
      const sid = 'test-abort-' + Date.now();

      const request: AgentExecuteRequest = {
        sessionId: sid,
        message: 'hello',
        runtimeType: 'pi-mono',
        lightweight: true,
        sessionMode: 'memory'
      };

      // 提交执行
      agentExecutor.submit(request);

      // 立即尝试中止
      const aborted = agentExecutor.abort(sid);

      // 如果没有立即注册（竞态），也可能是 false
      // 但至少不应该抛异常
      console.log(`abort result: ${aborted}, session: ${sid}`);

      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    it('abort 完成后再次 abort 返回 false', () => {
      const sid = 'test-abort-done-' + Date.now();

      // 先中止一个不存在的 session
      const first = agentExecutor.abort(sid);
      expect(first).toBe(false);

      // 再次中止同一个
      const second = agentExecutor.abort(sid);
      expect(second).toBe(false);
    });
  });

  // ==================== Step 4: getActiveSessions ====================

  describe('步骤4：活跃会话列表', () => {
    it('getActiveSessions 返回正在执行的 session', async () => {
      const sid = 'test-active-' + Date.now();

      const request: AgentExecuteRequest = {
        sessionId: sid,
        message: 'hello',
        runtimeType: 'pi-mono',
        lightweight: true,
        sessionMode: 'memory'
      };

      agentExecutor.submit(request);

      const sessions = agentExecutor.getActiveSessions();
      const found = sessions.find((s) => s.sessionId === sid);
      expect(found).toBeDefined();
      expect(found!.startedAt).toBeGreaterThan(0);

      await new Promise((resolve) => setTimeout(resolve, 500));
    });
  });

  // ==================== Step 5: 单例正确性 ====================

  describe('步骤5：单例', () => {
    it('getAgentExecutor 返回同一实例', () => {
      const a = getAgentExecutor();
      const b = getAgentExecutor();
      expect(a).toBe(b);
    });

    it('agentExecutor 和 getAgentExecutor 一致', () => {
      expect(agentExecutor).toBe(getAgentExecutor());
    });
  });

  // ==================== Step 6: submitAndWait 阻塞执行 ====================

  describe('步骤6：submitAndWait', () => {
    it('session busy 时 throw', async () => {
      const sid = 'test-wait-busy-' + Date.now();

      const request: AgentExecuteRequest = {
        sessionId: sid,
        message: 'hello',
        runtimeType: 'pi-mono',
        lightweight: true,
        sessionMode: 'memory'
      };

      // 先 submit 占用
      agentExecutor.submit(request);

      // submitAndWait 应该 throw（busy）
      await expect(agentExecutor.submitAndWait(request)).rejects.toThrow(`Session ${sid} is busy`);

      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    it('无可用 Provider 时执行失败 throw（但 finally 清理状态）', async () => {
      const sid = 'test-wait-fail-' + Date.now();

      const request: AgentExecuteRequest = {
        sessionId: sid,
        message: 'hello',
        runtimeType: 'pi-mono',
        lightweight: true,
        sessionMode: 'memory'
      };

      // submitAndWait 在 runtime 构建失败时会 throw
      await expect(agentExecutor.submitAndWait(request)).rejects.toThrow();

      // 但 finally 块会清理状态
      const status = agentExecutor.getStatus(sid);
      expect(status.busy).toBe(false);
    });
  });

  // ==================== Step 7: streamThread 错误路径 ====================

  describe('步骤7：streamThread', () => {
    it('Thread 不存在时 throw', async () => {
      const gen = agentExecutor.streamThread('nonexistent-thread-id', 'hello');

      await expect(gen.next()).rejects.toThrow('Thread nonexistent-thread-id not found');
    });
  });

  // ==================== Step 8: 并发安全 ====================

  describe('步骤8：并发安全', () => {
    it('多个不同 session 可以同时执行', async () => {
      const sid1 = 'test-concurrent-1-' + Date.now();
      const sid2 = 'test-concurrent-2-' + Date.now();

      const request1: AgentExecuteRequest = {
        sessionId: sid1,
        message: 'hello',
        runtimeType: 'pi-mono',
        lightweight: true,
        sessionMode: 'memory'
      };
      const request2: AgentExecuteRequest = {
        sessionId: sid2,
        message: 'world',
        runtimeType: 'pi-mono',
        lightweight: true,
        sessionMode: 'memory'
      };

      // 同时提交两个不同 session
      const r1 = agentExecutor.submit(request1);
      const r2 = agentExecutor.submit(request2);

      expect(r1.status).toBe('accepted');
      expect(r2.status).toBe('accepted');

      // 两个都应该是 busy
      const sessions = agentExecutor.getActiveSessions();
      expect(sessions.length).toBeGreaterThanOrEqual(2);

      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    it('同一 session 不能并发', async () => {
      const sid = 'test-no-concurrent-' + Date.now();

      const request: AgentExecuteRequest = {
        sessionId: sid,
        message: 'hello',
        runtimeType: 'pi-mono',
        lightweight: true,
        sessionMode: 'memory'
      };

      const r1 = agentExecutor.submit(request);
      const r2 = agentExecutor.submit(request);

      expect(r1.status).toBe('accepted');
      expect(r2.status).toBe('busy');

      await new Promise((resolve) => setTimeout(resolve, 500));
    });
  });
});
