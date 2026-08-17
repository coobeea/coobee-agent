import type { ExecContext } from '../definition/Tool';
import type { StreamUpdate, ToolResult } from '../../types/ToolTypes';
import { ToolCategoryFileSystem, ToolName } from '../../types/ToolTypes';
import { PathError, guard, normalizePath } from '../path/PathGuard';
import { createHandlerTool, type HandlerTool } from './HandlerTool';
import { writeParamsSchema } from './schemas';
import { WriteToolDescription } from './descriptions';
import { formatError, strParam, successResult } from './helpers';
import { mkdirParent, writeFileEnsured } from './io';

async function writeHandler(
  ctx: ExecContext,
  params: Record<string, unknown>,
  _onUpdate?: (update: StreamUpdate) => void
): Promise<ToolResult> {
  const filePath = strParam(params, 'path');
  const content = strParam(params, 'content');
  if (!filePath.trim()) return formatError('MISSING_PARAM', 'path is required');

  let abs: string;
  try {
    abs = normalizePath(filePath, ctx);
    guard(abs, ctx, filePath);
  } catch (err) {
    if (err instanceof PathError) return formatError(err.code, err.message);
    throw err;
  }

  try {
    await mkdirParent(abs);
    await writeFileEnsured(abs, content);
  } catch (err) {
    return formatError('WRITE_ERROR', err instanceof Error ? err.message : String(err));
  }

  const lineCount = content ? content.split('\n').length : 1;
  const byteSize = Buffer.byteLength(content, 'utf8');
  return successResult(`Successfully wrote ${byteSize} bytes (${lineCount} lines) to ${abs}`);
}

export function createWriteTool(): HandlerTool {
  return createHandlerTool(ToolName.Write, WriteToolDescription, ToolCategoryFileSystem, writeHandler, {
    parametersSchema: writeParamsSchema
  });
}
