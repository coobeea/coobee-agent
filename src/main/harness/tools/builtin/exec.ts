import type { ExecContext } from '../definition/Tool';
import type { StreamUpdate, ToolResult } from '../../types/ToolTypes';
import { ToolCategoryExecute, ToolName } from '../../types/ToolTypes';
import { createHandlerTool, type HandlerTool } from './HandlerTool';
import { execParamsSchema } from './schemas';
import { ExecToolDescription } from './descriptions';
import {
  emitOutput,
  emitProgress,
  formatError,
  optionalBool,
  optionalInt,
  strParam,
  successResult,
  vesselEnvFromExecContext,
  workspaceCwd
} from './helpers';
import { getBackgroundStore } from './BackgroundStore';
import { runShell, truncateOutput } from './io';

const EXEC_MAX_OUTPUT_BYTES = 100_000;

function execProgress(description: string, command: string, background: boolean): string {
  const desc = description.trim();
  const prefix = background ? '[Background] $' : '$';
  if (desc) return `[${desc}] ${prefix} ${command}`;
  return `${prefix} ${command}`;
}

function formatExecOutput(
  stdout: string,
  stderr: string,
  exitCode: number,
  timedOut: boolean,
  timeout: number | undefined,
  aborted: boolean
): string {
  const parts: string[] = [];
  if (aborted) parts.push('[Cancelled]');
  if (timedOut && timeout) parts.push(`[Timed out after ${timeout}ms]`);
  parts.push(`Exit code: ${exitCode}`);
  const out = truncateOutput(stdout, EXEC_MAX_OUTPUT_BYTES);
  const err = truncateOutput(stderr, EXEC_MAX_OUTPUT_BYTES);
  if (out.trim()) parts.push(`stdout:\n${out.trim()}`);
  if (err.trim()) parts.push(`stderr:\n${err.trim()}`);
  return parts.join('\n\n');
}

async function execHandler(
  ctx: ExecContext,
  params: Record<string, unknown>,
  onUpdate?: (update: StreamUpdate) => void
): Promise<ToolResult> {
  const command = strParam(params, 'command');
  const description = strParam(params, 'description');
  const background = optionalBool(params, 'background') ?? false;
  const timeout = optionalInt(params, 'timeout');

  if (!command.trim()) return formatError('MISSING_PARAM', 'command is required');

  const cwd = workspaceCwd(ctx);
  if (!cwd) return formatError('NO_WORKSPACE', 'workspace is not available');

  const env = vesselEnvFromExecContext(ctx);

  if (background) {
    emitProgress(onUpdate, execProgress(description, command, true), 0);
    try {
      const runId = await getBackgroundStore().startBackground(ctx.sessionId, command, cwd, env);
      const llmContent = `[Background] Process started.\nprocessId: ${runId}\nUse the \`process\` tool (action=read/write/kill, processId=${JSON.stringify(runId)}) to manage it.`;
      emitOutput(onUpdate, llmContent);
      const desc = description.trim();
      if (desc) {
        return successResult(
          `[${desc}] Background: $ ${command}\nprocessId: ${runId}\nUse process tool with action=list/read/wait/kill/remove.`
        );
      }
      return successResult(
        `Background: $ ${command}\nprocessId: ${runId}\nUse process tool with action=list/read/wait/kill/remove.`
      );
    } catch (err) {
      return formatError('EXEC_ERROR', err instanceof Error ? err.message : String(err));
    }
  }

  emitProgress(onUpdate, execProgress(description, command, false), 0);
  try {
    const res = await runShell(cwd, command, {
      timeoutMs: timeout,
      env
    });
    const out = formatExecOutput(res.stdout, res.stderr, res.exitCode, res.timedOut, timeout, res.aborted);
    const desc = description.trim();
    if (desc) return successResult(`[${desc}] $ ${command}\n\n${out}`);
    return successResult(`$ ${command}\n\n${out}`);
  } catch (err) {
    return formatError('EXEC_ERROR', err instanceof Error ? err.message : String(err));
  }
}

export function createExecTool(): HandlerTool {
  return createHandlerTool(ToolName.Exec, ExecToolDescription, ToolCategoryExecute, execHandler, {
    parametersSchema: execParamsSchema
  });
}
