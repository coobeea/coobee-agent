import type { ExecContext } from '../definition/Tool';
import type { StreamUpdate, ToolResult } from '../../types/ToolTypes';
import { ToolCategoryExecute, ToolName } from '../../types/ToolTypes';
import { createHandlerTool, type HandlerTool } from './HandlerTool';
import { processParamsSchema } from './schemas';
import { ProcessToolDescription } from './descriptions';
import { emitProgress, formatError, optionalInt, strParam, successResult } from './helpers';
import {
  formatBackgroundSummary,
  getBackgroundStore,
  truncateProcessRead,
  type BackgroundSnapshot
} from './BackgroundStore';

type ProcessAction = 'list' | 'read' | 'write' | 'wait' | 'kill' | 'remove' | '';

async function processHandler(
  ctx: ExecContext,
  params: Record<string, unknown>,
  onUpdate?: (update: StreamUpdate) => void
): Promise<ToolResult> {
  const action = (strParam(params, 'action') || 'list') as ProcessAction;
  const processId = strParam(params, 'processId').trim();
  const data = strParam(params, 'data');
  const timeoutMs = optionalInt(params, 'timeoutMs');
  const stateFilter = strParam(params, 'state').trim();

  emitProgress(onUpdate, `[process] action=${action}`, 0);
  const store = getBackgroundStore();
  const sessionId = ctx.sessionId;

  switch (action) {
    case 'list':
    case '': {
      const all = store.list(sessionId);
      let running = 0;
      let exited = 0;
      for (const e of all) {
        if (e.state === 'running') running++;
        else exited++;
      }
      if (all.length === 0) {
        return successResult(
          sessionId ? `No background processes in session ${sessionId}.` : 'No background processes.'
        );
      }
      let filtered = all;
      if (stateFilter) {
        filtered = all.filter((e) => e.state === stateFilter);
      }
      const header = `Session ${sessionId}: ${running} running, ${exited} exited, ${all.length} total.`;
      if (filtered.length === 0) {
        return successResult(`${header}\n(No entries match the filter.)`);
      }
      const parts = filtered.map((e, i) => `[${i + 1}] ${formatBackgroundSummary(e)}`);
      return successResult(`${header}\n\n${parts.join('\n\n')}`);
    }

    case 'read': {
      if (!processId) return formatError('INVALID_PARAM', 'processId is required for action=read');
      const e = store.getOwned(processId, sessionId);
      if (!e) return formatError('PROCESS_NOT_FOUND', `No process ${processId}`);
      const snap = store.snapshot(e);
      return successResult(formatProcessOutput(snap));
    }

    case 'kill': {
      if (!processId) return formatError('INVALID_PARAM', 'processId is required for action=kill');
      const e = store.getOwned(processId, sessionId);
      if (!e) return formatError('PROCESS_NOT_FOUND', `No process ${processId}`);
      if (e.state === 'exited') {
        const code = e.exitCode != null ? String(e.exitCode) : 'null';
        return successResult(`Process ${processId} already exited (exitCode=${code}).`);
      }
      if (store.kill(processId, 'manual-cancel')) {
        return successResult(`Kill signal sent to process ${processId}.`);
      }
      return formatError('KILL_FAILED', `Failed to kill process ${processId}`);
    }

    case 'remove': {
      if (!processId) return formatError('INVALID_PARAM', 'processId is required for action=remove');
      const e = store.getOwned(processId, sessionId);
      if (!e) return formatError('PROCESS_NOT_FOUND', `No process ${processId}`);
      if (e.state !== 'exited') {
        return formatError('PROCESS_STILL_RUNNING', `cannot remove running process ${processId}`);
      }
      const code = e.exitCode != null ? String(e.exitCode) : 'null';
      store.remove(processId);
      return successResult(`Removed entry ${processId} (exitCode=${code}).`);
    }

    case 'wait': {
      if (!processId) return formatError('INVALID_PARAM', 'processId is required for action=wait');
      if (!store.getOwned(processId, sessionId)) {
        return formatError('PROCESS_NOT_FOUND', `No process ${processId}`);
      }
      const { status, snap } = await store.waitForExit(processId, timeoutMs);
      if (status === 'not-found') {
        return formatError('PROCESS_NOT_FOUND', `No process ${processId}`);
      }
      const body = formatProcessOutput(snap);
      if (status === 'timeout' && timeoutMs) {
        const msg = `[Wait timed out after ${timeoutMs}ms; process still running]\n\n${body}`;
        return formatError('WAIT_TIMEOUT', msg);
      }
      return successResult(body);
    }

    case 'write': {
      if (!processId || !data) {
        return formatError('INVALID_PARAM', 'processId and data are required for action=write');
      }
      const e = store.getOwned(processId, sessionId);
      if (!e) return formatError('PROCESS_NOT_FOUND', `No process ${processId}`);
      if (e.state !== 'running') {
        return formatError('STDIN_UNAVAILABLE', `cannot write to stdin (state=${e.state})`);
      }
      if (!store.writeStdin(processId, data)) {
        return formatError('STDIN_UNAVAILABLE', 'stdin unavailable');
      }
      return successResult(`Wrote ${data.length} bytes to stdin of ${processId}.`);
    }

    default:
      return formatError('INVALID_PARAM', `unknown action ${JSON.stringify(action)}`);
  }
}

function formatProcessOutput(snap: BackgroundSnapshot): string {
  const parts = [formatBackgroundSummary(snap)];
  const stdout = truncateProcessRead(snap.stdout, 'stdout');
  const stderr = truncateProcessRead(snap.stderr, 'stderr');
  if (stdout.trim()) parts.push(`--- stdout ---\n${stdout}`);
  if (stderr.trim()) parts.push(`--- stderr ---\n${stderr}`);
  return parts.join('\n\n');
}

export function createProcessTool(): HandlerTool {
  return createHandlerTool(ToolName.Process, ProcessToolDescription, ToolCategoryExecute, processHandler, {
    parametersSchema: processParamsSchema
  });
}
