import type { StreamUpdate, ToolResult } from '../../types/ToolTypes';

export function formatError(code: string, message: string): ToolResult {
  const normalized = code.trim() || 'UNKNOWN';
  const llmContent = `Error: ${normalized}: ${message}`;
  return {
    success: false,
    error: { code: normalized, message },
    llmContent
  };
}

export function successResult(llmContent: string): ToolResult {
  return { success: true, llmContent };
}

export function cancelledResult(): ToolResult {
  return formatError('ABORTED', 'Operation cancelled');
}

export function strParam(params: Record<string, unknown>, key: string): string {
  const v = params[key];
  return typeof v === 'string' ? v : v != null ? String(v) : '';
}

export function optionalStr(params: Record<string, unknown>, key: string): string | undefined {
  const v = params[key];
  if (v == null) return undefined;
  const s = typeof v === 'string' ? v : String(v);
  return s.trim() ? s : undefined;
}

export function optionalBool(params: Record<string, unknown>, key: string): boolean | undefined {
  const v = params[key];
  if (typeof v === 'boolean') return v;
  return undefined;
}

export function optionalInt(params: Record<string, unknown>, key: string): number | undefined {
  const v = params[key];
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && v.trim()) {
    const n = Number.parseInt(v, 10);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function emitProgress(
  onUpdate: ((update: StreamUpdate) => void) | undefined,
  content: string,
  percentage?: number
): void {
  onUpdate?.({ type: 'progress', content, percentage });
}

export function emitOutput(onUpdate: ((update: StreamUpdate) => void) | undefined, content: string): void {
  onUpdate?.({ type: 'output', content });
}

export function workspaceCwd(ctx: { workspaceRoot: string; agentRoot: string }): string {
  return ctx.workspaceRoot || ctx.agentRoot || process.cwd();
}

export function vesselEnvFromExecContext(ctx: {
  sessionId: string;
  userId: string;
  agentId: string;
  runtimeId: string;
  sessionRoot: string;
  workspaceRoot: string;
  agentRoot: string;
}): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (k: string, v: string): void => {
    const trimmed = v.trim();
    if (trimmed) out[k] = trimmed;
  };
  put('VESSEL_SESSION_ID', ctx.sessionId);
  put('VESSEL_USER_ID', ctx.userId);
  put('VESSEL_AGENT_ID', ctx.agentId);
  put('VESSEL_RUNTIME_ID', ctx.runtimeId);
  put('VESSEL_SESSION_ROOT', ctx.sessionRoot);
  put('VESSEL_WORKSPACE_ROOT', ctx.workspaceRoot);
  put('VESSEL_AGENT_ROOT', ctx.agentRoot);
  return out;
}
