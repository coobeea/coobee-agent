/**
 * process — 后台进程管理工具
 *
 * 配合 exec(background=true) 使用：
 *   - list: 列出当前会话的所有后台进程（可按 state 过滤）
 *   - read: 读取指定 runId 的 stdout/stderr + 退出状态
 *   - write: 往指定 runId 的 stdin 写入数据
 *   - wait: 阻塞等到进程退出（或超时）
 *   - kill: 终止指定 runId 的进程（SIGKILL + 组杀）
 *   - remove: 从 store 中删除已退出的 entry（回收内存）
 */
import { z } from 'zod';
import type { ToolDefinition, ToolStreamUpdate, ToolResult, ToolExecutionContext } from '../types';
import { ToolCategory } from '../types';
import { getBackgroundStore } from '../../process';
import type { BackgroundEntrySnapshot } from '../../process';

const MAX_READ_BYTES = 100_000;

function formatSummary(entry: BackgroundEntrySnapshot): string {
  const parts: string[] = [];
  parts.push(`runId: ${entry.runId}`);
  parts.push(`state: ${entry.state}`);
  if (entry.pid != null) parts.push(`pid: ${entry.pid}`);
  parts.push(`command: ${entry.command}`);
  parts.push(`cwd: ${entry.cwd}`);
  parts.push(`startedAt: ${new Date(entry.startedAtMs).toISOString()}`);
  if (entry.state === 'exited') {
    if (entry.exitedAtMs != null) parts.push(`exitedAt: ${new Date(entry.exitedAtMs).toISOString()}`);
    parts.push(`exitCode: ${entry.exitCode ?? 'null'}`);
    if (entry.exitSignal != null) parts.push(`exitSignal: ${entry.exitSignal}`);
    if (entry.terminationReason) parts.push(`reason: ${entry.terminationReason}`);
  }
  parts.push(`stdoutBytes: ${entry.stdoutBytes}${entry.stdoutTruncated ? ' (truncated)' : ''}`);
  parts.push(`stderrBytes: ${entry.stderrBytes}${entry.stderrTruncated ? ' (truncated)' : ''}`);
  return parts.join('\n');
}

function truncateForRead(text: string, label: string): { text: string; truncated: boolean } {
  const bytes = Buffer.byteLength(text, 'utf-8');
  if (bytes <= MAX_READ_BYTES) return { text, truncated: false };
  const truncated = Buffer.from(text, 'utf-8').subarray(0, MAX_READ_BYTES).toString('utf-8');
  return {
    text: `${truncated}\n... [${label} truncated at ${MAX_READ_BYTES} bytes; ${bytes} total]`,
    truncated: true
  };
}

export const processTool: ToolDefinition = {
  name: 'process',
  description:
    'Manage background processes started by `exec(background=true)`.\n' +
    '- action=list (optional state filter): list all background processes in current session. Metadata includes runningCount/exitedCount/total.\n' +
    '- action=read (requires processId): read stdout/stderr and exit status.\n' +
    '- action=write (requires processId, data): write data to stdin.\n' +
    '- action=wait (requires processId, optional timeoutMs): block until the process exits (or timeout). Returns final stdout/stderr/exitCode.\n' +
    '- action=kill (requires processId): terminate the process.\n' +
    '- action=remove (requires processId): drop an already-exited entry from the store. Fails if still running.',
  category: ToolCategory.Execute,
  needUserConfirm: false,
  parameters: z.object({
    action: z.enum(['list', 'read', 'write', 'wait', 'kill', 'remove']).describe('Action to perform'),
    processId: z.string().optional().describe('Background process runId (required for read/write/wait/kill/remove)'),
    data: z.string().optional().describe('Data to write to stdin (required for action=write)'),
    timeoutMs: z.number().optional().describe('Timeout in milliseconds for action=wait. Omit to wait indefinitely.'),
    state: z.enum(['running', 'exited']).optional().describe('Optional state filter for action=list. Omit to list all.')
  }),
  async *execute(
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    context?: ToolExecutionContext
  ): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    const action = params.action as 'list' | 'read' | 'write' | 'wait' | 'kill' | 'remove';
    const processId = typeof params.processId === 'string' ? params.processId.trim() : undefined;
    const data = typeof params.data === 'string' ? params.data : undefined;
    const timeoutMs =
      typeof params.timeoutMs === 'number' && Number.isFinite(params.timeoutMs) && params.timeoutMs > 0
        ? params.timeoutMs
        : undefined;
    const stateFilter =
      params.state === 'running' || params.state === 'exited' ? (params.state as 'running' | 'exited') : undefined;

    const store = getBackgroundStore();
    const sessionId = typeof context?.sessionId === 'string' ? context.sessionId : undefined;

    yield { type: 'progress', content: `[process] action=${action}`, percentage: 0 };

    switch (action) {
      case 'list': {
        const all = store.list(sessionId);
        const runningCount = all.filter((e) => e.state === 'running').length;
        const exitedCount = all.filter((e) => e.state === 'exited').length;
        const filtered = stateFilter ? all.filter((e) => e.state === stateFilter) : all;

        if (all.length === 0) {
          const msg = sessionId ? `No background processes in session ${sessionId}.` : 'No background processes.';
          return {
            success: true,
            llmContent: msg,
            userContent: msg,
            metadata: { total: 0, runningCount: 0, exitedCount: 0, returnedCount: 0, stateFilter }
          };
        }

        const header = stateFilter
          ? `Session ${sessionId ?? '(all)'}: ${runningCount} running, ${exitedCount} exited, ${all.length} total. Filter: state=${stateFilter} → ${filtered.length} matched.`
          : `Session ${sessionId ?? '(all)'}: ${runningCount} running, ${exitedCount} exited, ${all.length} total.`;

        if (filtered.length === 0) {
          const msg = `${header}\n(No entries match the filter.)`;
          return {
            success: true,
            llmContent: msg,
            userContent: msg,
            metadata: { total: all.length, runningCount, exitedCount, returnedCount: 0, stateFilter }
          };
        }

        const body = filtered.map((e, i) => `[${i + 1}] ${formatSummary(e)}`).join('\n\n');
        const content = `${header}\n\n${body}`;
        return {
          success: true,
          llmContent: content,
          userContent: content,
          metadata: {
            total: all.length,
            runningCount,
            exitedCount,
            returnedCount: filtered.length,
            stateFilter
          }
        };
      }

      case 'read': {
        if (!processId) {
          return {
            success: false,
            llmContent: 'Error: processId is required for action=read',
            error: { code: 'INVALID_PARAM', message: 'processId is required' }
          };
        }
        const entry = store.get(processId);
        if (!entry) {
          return {
            success: false,
            llmContent: `Error: process not found (runId=${processId})`,
            error: { code: 'PROCESS_NOT_FOUND', message: `No background process with runId=${processId}` }
          };
        }
        const { text: stdoutText } = truncateForRead(entry.stdout, 'stdout');
        const { text: stderrText } = truncateForRead(entry.stderr, 'stderr');
        const parts: string[] = [formatSummary(entry)];
        if (stdoutText.trim()) parts.push(`--- stdout ---\n${stdoutText}`);
        if (stderrText.trim()) parts.push(`--- stderr ---\n${stderrText}`);
        const content = parts.join('\n\n');
        return {
          success: true,
          llmContent: content,
          userContent: content,
          metadata: {
            runId: entry.runId,
            state: entry.state,
            exitCode: entry.exitCode,
            pid: entry.pid,
            stdoutBytes: entry.stdoutBytes,
            stderrBytes: entry.stderrBytes,
            stdoutTruncated: entry.stdoutTruncated,
            stderrTruncated: entry.stderrTruncated
          }
        };
      }

      case 'write': {
        if (!processId) {
          return {
            success: false,
            llmContent: 'Error: processId is required for action=write',
            error: { code: 'INVALID_PARAM', message: 'processId is required' }
          };
        }
        if (data == null) {
          return {
            success: false,
            llmContent: 'Error: data is required for action=write',
            error: { code: 'INVALID_PARAM', message: 'data is required' }
          };
        }
        const entry = store.get(processId);
        if (!entry) {
          return {
            success: false,
            llmContent: `Error: process not found (runId=${processId})`,
            error: { code: 'PROCESS_NOT_FOUND', message: `No background process with runId=${processId}` }
          };
        }
        const ok = store.writeStdin(processId, data);
        if (!ok) {
          return {
            success: false,
            llmContent: `Error: cannot write to stdin (process state=${entry.state})`,
            error: { code: 'STDIN_UNAVAILABLE', message: 'Process stdin is closed or not available' }
          };
        }
        const msg = `Wrote ${Buffer.byteLength(data, 'utf-8')} bytes to stdin of ${processId}.`;
        return {
          success: true,
          llmContent: msg,
          userContent: msg,
          metadata: { runId: processId, bytesWritten: Buffer.byteLength(data, 'utf-8') }
        };
      }

      case 'wait': {
        if (!processId) {
          return {
            success: false,
            llmContent: 'Error: processId is required for action=wait',
            error: { code: 'INVALID_PARAM', message: 'processId is required' }
          };
        }
        const result = await store.waitForExit(processId, timeoutMs);
        if (result.status === 'not-found') {
          return {
            success: false,
            llmContent: `Error: process not found (runId=${processId})`,
            error: { code: 'PROCESS_NOT_FOUND', message: `No background process with runId=${processId}` }
          };
        }
        const entry = result.entry;
        const { text: stdoutText } = truncateForRead(entry.stdout, 'stdout');
        const { text: stderrText } = truncateForRead(entry.stderr, 'stderr');
        const parts: string[] = [];
        if (result.status === 'timeout') {
          parts.push(`[Wait timed out after ${timeoutMs}ms; process still running]`);
        }
        parts.push(formatSummary(entry));
        if (stdoutText.trim()) parts.push(`--- stdout ---\n${stdoutText}`);
        if (stderrText.trim()) parts.push(`--- stderr ---\n${stderrText}`);
        const content = parts.join('\n\n');
        return {
          success: result.status === 'exited',
          llmContent: content,
          userContent: content,
          error:
            result.status === 'timeout'
              ? { code: 'WAIT_TIMEOUT', message: `Wait timed out after ${timeoutMs}ms` }
              : undefined,
          metadata: {
            runId: entry.runId,
            state: entry.state,
            exitCode: entry.exitCode,
            exitSignal: entry.exitSignal,
            terminationReason: entry.terminationReason,
            pid: entry.pid,
            waitStatus: result.status,
            stdoutBytes: entry.stdoutBytes,
            stderrBytes: entry.stderrBytes,
            stdoutTruncated: entry.stdoutTruncated,
            stderrTruncated: entry.stderrTruncated
          }
        };
      }

      case 'kill': {
        if (!processId) {
          return {
            success: false,
            llmContent: 'Error: processId is required for action=kill',
            error: { code: 'INVALID_PARAM', message: 'processId is required' }
          };
        }
        const entry = store.get(processId);
        if (!entry) {
          return {
            success: false,
            llmContent: `Error: process not found (runId=${processId})`,
            error: { code: 'PROCESS_NOT_FOUND', message: `No background process with runId=${processId}` }
          };
        }
        if (entry.state === 'exited') {
          const msg = `Process ${processId} already exited (exitCode=${entry.exitCode ?? 'null'}).`;
          return {
            success: true,
            llmContent: msg,
            userContent: msg,
            metadata: { runId: processId, alreadyExited: true }
          };
        }
        const ok = store.kill(processId, 'manual-cancel');
        const msg = ok ? `Kill signal sent to process ${processId}.` : `Failed to kill process ${processId}.`;
        return {
          success: ok,
          llmContent: msg,
          userContent: msg,
          error: ok ? undefined : { code: 'KILL_FAILED', message: `Failed to send cancel to ${processId}` },
          metadata: { runId: processId, killed: ok }
        };
      }

      case 'remove': {
        if (!processId) {
          return {
            success: false,
            llmContent: 'Error: processId is required for action=remove',
            error: { code: 'INVALID_PARAM', message: 'processId is required' }
          };
        }
        const entry = store.get(processId);
        if (!entry) {
          return {
            success: false,
            llmContent: `Error: process not found (runId=${processId})`,
            error: { code: 'PROCESS_NOT_FOUND', message: `No background process with runId=${processId}` }
          };
        }
        if (entry.state !== 'exited') {
          return {
            success: false,
            llmContent: `Error: cannot remove running process ${processId}. Kill or wait for it first.`,
            error: { code: 'PROCESS_STILL_RUNNING', message: `Process ${processId} is still running` },
            metadata: { runId: processId, state: entry.state }
          };
        }
        store.remove(processId);
        const msg = `Removed entry ${processId} (exitCode=${entry.exitCode ?? 'null'}).`;
        return {
          success: true,
          llmContent: msg,
          userContent: msg,
          metadata: { runId: processId, removed: true }
        };
      }

      default:
        return {
          success: false,
          llmContent: `Error: unknown action \`${String(action)}\``,
          error: { code: 'INVALID_PARAM', message: `Unknown action: ${String(action)}` }
        };
    }
  }
};
