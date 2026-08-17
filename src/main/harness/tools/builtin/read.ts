import type { ExecContext } from '../definition/Tool';
import type { StreamUpdate, ToolResult } from '../../types/ToolTypes';
import { ToolCategoryFileSystem, ToolName } from '../../types/ToolTypes';
import { PathError, guard, normalizePath } from '../path/PathGuard';
import { createHandlerTool, type HandlerTool } from './HandlerTool';
import { readParamsSchema } from './schemas';
import { ReadToolDescription } from './descriptions';
import { formatError, optionalInt, strParam, successResult } from './helpers';
import { recoverableFileMissing } from './recoverable';
import { formatNumberedLines, isBinaryFile, readFileLimited, statFile } from './io';

const DEFAULT_MAX_LINES = 2000;
const MAX_FILE_SIZE = 50 * 1024 * 1024;

async function readHandler(
  ctx: ExecContext,
  params: Record<string, unknown>,
  _onUpdate?: (update: StreamUpdate) => void
): Promise<ToolResult> {
  const filePath = strParam(params, 'path');
  if (!filePath.trim()) return formatError('MISSING_PARAM', 'path is required');

  let abs: string;
  try {
    abs = normalizePath(filePath, ctx);
    guard(abs, ctx, filePath);
  } catch (err) {
    if (err instanceof PathError) return formatError(err.code, err.message);
    throw err;
  }

  let info;
  try {
    info = await statFile(abs);
  } catch {
    return recoverableFileMissing(abs);
  }

  if (!info.isFile()) {
    return formatError('NOT_FILE', `${abs} is not a file`);
  }
  if (info.size > MAX_FILE_SIZE) {
    return formatError('FILE_TOO_LARGE', 'file exceeds size limit');
  }
  if (await isBinaryFile(abs)) {
    return formatError('BINARY_FILE', 'cannot read binary file');
  }

  let content: Buffer;
  try {
    content = await readFileLimited(abs, MAX_FILE_SIZE);
  } catch (err) {
    return formatError('READ_ERROR', err instanceof Error ? err.message : String(err));
  }

  const offset = Math.max(1, optionalInt(params, 'offset') ?? 1);
  let limit = DEFAULT_MAX_LINES;
  const limitParam = optionalInt(params, 'limit');
  if (limitParam && limitParam > 0 && limitParam < DEFAULT_MAX_LINES) {
    limit = limitParam;
  }

  return successResult(formatNumberedLines(content.toString('utf8'), offset, limit));
}

export function createReadTool(): HandlerTool {
  return createHandlerTool(ToolName.Read, ReadToolDescription, ToolCategoryFileSystem, readHandler, {
    parametersSchema: readParamsSchema
  });
}
