import type { ExecContext } from '../definition/Tool';
import type { StreamUpdate, ToolResult } from '../../types/ToolTypes';
import { ToolCategoryFileSystem, ToolName } from '../../types/ToolTypes';
import { PathError, guard, normalizePath } from '../path/PathGuard';
import { createHandlerTool, type HandlerTool } from './HandlerTool';
import { editParamsSchema } from './schemas';
import { EditToolDescription } from './descriptions';
import { formatError, optionalBool, strParam, successResult } from './helpers';
import { recoverableFileMissing } from './recoverable';
import { readFileLimited, statFile, writeFileEnsured } from './io';

const MAX_FILE_SIZE = 50 * 1024 * 1024;

async function editHandler(
  ctx: ExecContext,
  params: Record<string, unknown>,
  _onUpdate?: (update: StreamUpdate) => void
): Promise<ToolResult> {
  const filePath = strParam(params, 'path');
  const oldText = strParam(params, 'oldText');
  const newText = strParam(params, 'newText');
  const replaceAll = optionalBool(params, 'replaceAll') ?? false;

  if (!filePath.trim()) return formatError('MISSING_PARAM', 'path is required');
  if (oldText === newText) {
    return formatError('IDENTICAL', 'oldText and newText are identical, nothing to change');
  }

  let abs: string;
  try {
    abs = normalizePath(filePath, ctx);
    guard(abs, ctx, filePath);
  } catch (err) {
    if (err instanceof PathError) return formatError(err.code, err.message);
    throw err;
  }

  let content: Buffer;
  try {
    await statFile(abs);
    content = await readFileLimited(abs, MAX_FILE_SIZE);
  } catch {
    return recoverableFileMissing(abs);
  }

  const text = content.toString('utf8');
  const occurrences = text.split(oldText).length - 1;
  if (occurrences === 0) {
    let hint = '';
    const trimmed = oldText.trim();
    if (trimmed && text.includes(trimmed)) {
      hint = ' (a trimmed version was found — check whitespace)';
    }
    return formatError('NOT_FOUND', `oldText not found in ${abs}${hint}`);
  }
  if (!replaceAll && occurrences > 1) {
    return formatError(
      'MULTIPLE_MATCHES',
      `oldText matches ${occurrences} times in ${abs}. Include more surrounding context to make it unique, or set replaceAll to true.`
    );
  }

  const updated = replaceAll ? text.split(oldText).join(newText) : text.replace(oldText, newText);

  try {
    await writeFileEnsured(abs, updated);
  } catch (err) {
    return formatError('WRITE_ERROR', err instanceof Error ? err.message : String(err));
  }

  const oldLines = oldText.split('\n').length;
  const newLines = newText.split('\n').length;
  if (replaceAll) {
    return successResult(
      `Replaced ${occurrences} occurrence(s) (${oldLines} line(s) each) with ${newLines} line(s) in ${abs}`
    );
  }
  return successResult(`Replaced ${oldLines} line(s) with ${newLines} line(s) in ${abs}`);
}

export function createEditTool(): HandlerTool {
  return createHandlerTool(ToolName.Edit, EditToolDescription, ToolCategoryFileSystem, editHandler, {
    parametersSchema: editParamsSchema
  });
}
