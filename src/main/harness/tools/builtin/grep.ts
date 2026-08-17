import path from 'node:path';
import { readdir } from 'node:fs/promises';
import type { ExecContext } from '../definition/Tool';
import type { StreamUpdate, ToolResult } from '../../types/ToolTypes';
import { SkipDirNames } from '../../types/Constants';
import { ToolCategorySearch, ToolName } from '../../types/ToolTypes';
import { PathError, guard, normalizePath } from '../path/PathGuard';
import { createHandlerTool, type HandlerTool } from './HandlerTool';
import { grepParamsSchema } from './schemas';
import { GrepToolDescription } from './descriptions';
import { formatError, optionalBool, optionalInt, optionalStr, strParam, successResult, workspaceCwd } from './helpers';
import { recoverableContentEmpty, recoverableSearchRootMissing } from './recoverable';
import { commandExists, readFileLimited, runCommand, statFile } from './io';

const GREP_MAX_OUTPUT = 100_000;
const GREP_DEFAULT_HEAD = 200;

type GrepOutputMode = 'content' | 'files_with_matches' | 'count';

async function resolveGrepScanRoot(ctx: ExecContext, scanPath?: string): Promise<string> {
  if (!scanPath?.trim()) {
    return path.normalize(workspaceCwd(ctx));
  }
  const abs = normalizePath(scanPath, ctx);
  guard(abs, ctx, scanPath);
  return abs;
}

function buildRipgrepArgs(params: Record<string, unknown>, scanRoot: string): string[] {
  const outputMode = (optionalStr(params, 'output_mode') ?? 'content') as GrepOutputMode;
  let headLimit = GREP_DEFAULT_HEAD;
  const headParam = optionalInt(params, 'head_limit');
  if (headParam && headParam > 0 && headParam < GREP_DEFAULT_HEAD) {
    headLimit = headParam;
  }

  const args = ['--color', 'never'];
  if (outputMode === 'content') args.push('--line-number');
  if (!optionalBool(params, 'caseSensitive')) args.push('-i');

  const glob = optionalStr(params, 'glob');
  if (glob) args.push('--glob', glob);

  const type = optionalStr(params, 'type');
  if (type) args.push('--type', type);

  if (optionalBool(params, 'multiline')) args.push('-U', '--multiline-dotall');

  if (outputMode === 'content') {
    const context = optionalInt(params, 'context');
    if (context && context > 0) {
      args.push('-C', String(context));
    } else {
      const before = optionalInt(params, 'contextBefore');
      const after = optionalInt(params, 'contextAfter');
      if (before && before > 0) args.push('-B', String(before));
      if (after && after > 0) args.push('-A', String(after));
    }
  }

  if (outputMode === 'files_with_matches') args.push('-l');
  else if (outputMode === 'count') args.push('--count');
  else if (headLimit > 0) args.push('-m', String(headLimit));

  args.push('--', strParam(params, 'pattern'), scanRoot);
  return args;
}

function truncateGrepOutput(text: string): string {
  if (text.length <= GREP_MAX_OUTPUT) return text;
  return `${text.slice(0, GREP_MAX_OUTPUT)}\n... [output truncated at ${GREP_MAX_OUTPUT} bytes; ${text.length} total]`;
}

async function grepWithRg(params: Record<string, unknown>, scanRoot: string): Promise<ToolResult | null> {
  const rgBin = process.env.VESSEL_RG_BIN?.trim() || 'rg';
  if (!(await commandExists(rgBin))) return null;

  const args = buildRipgrepArgs(params, scanRoot);
  const res = await runCommand(scanRoot, rgBin, args);
  if (res.exitCode === 2) {
    const errText = res.stderr.trim() || 'ripgrep failed';
    return formatError('RG_ERROR', errText);
  }

  const out = truncateGrepOutput(res.stdout);
  if (res.exitCode === 1 || !out.trim()) {
    const r = recoverableContentEmpty(strParam(params, 'pattern'), scanRoot);
    return { success: r.success, llmContent: r.llmContent };
  }

  let body = out.trimEnd();
  const stderrText = res.stderr.trim();
  if (stderrText) body += `\n\n[rg stderr]\n${stderrText}`;
  return successResult(`Found match(es) for ${JSON.stringify(strParam(params, 'pattern'))}:\n\n${body}`);
}

async function collectFiles(dir: string, files: string[], maxFiles: number): Promise<void> {
  if (files.length >= maxFiles) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (files.length >= maxFiles) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SkipDirNames.has(entry.name)) continue;
      await collectFiles(full, files, maxFiles);
    } else {
      files.push(full);
    }
  }
}

async function grepWithWalk(params: Record<string, unknown>, scanRoot: string): Promise<ToolResult> {
  const pattern = strParam(params, 'pattern');
  const caseSensitive = optionalBool(params, 'caseSensitive') ?? false;
  let re: RegExp;
  try {
    re = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
  } catch (err) {
    return formatError(
      'INVALID_PATTERN',
      `invalid regex pattern ${JSON.stringify(pattern)}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const files: string[] = [];
  const rootStat = await statFile(scanRoot);
  if (rootStat.isFile()) files.push(scanRoot);
  else await collectFiles(scanRoot, files, 2000);

  const matches: string[] = [];
  const headLimit = optionalInt(params, 'head_limit') ?? GREP_DEFAULT_HEAD;

  for (const filePath of files) {
    if (matches.length >= headLimit) break;
    let data: Buffer;
    try {
      const st = await statFile(filePath);
      if (!st.isFile() || st.size > 2 * 1024 * 1024) continue;
      data = await readFileLimited(filePath, 2 * 1024 * 1024);
    } catch {
      continue;
    }
    const lines = data.toString('utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (matches.length >= headLimit) break;
      if (re.test(lines[i]!)) {
        matches.push(`${path.normalize(filePath)}:${i + 1}:${lines[i]}`);
        re.lastIndex = 0;
      }
    }
  }

  if (matches.length === 0) {
    const r = recoverableContentEmpty(pattern, scanRoot);
    return { success: r.success, llmContent: r.llmContent };
  }

  const body = truncateGrepOutput(matches.join('\n'));
  return successResult(`Found match(es) for ${JSON.stringify(pattern)}:\n\n${body}`);
}

async function grepHandler(
  ctx: ExecContext,
  params: Record<string, unknown>,
  _onUpdate?: (update: StreamUpdate) => void
): Promise<ToolResult> {
  if (!ctx.workspaceRoot && !ctx.agentRoot) {
    return formatError('NO_WORKSPACE', 'project not available');
  }

  const pattern = strParam(params, 'pattern');
  if (!pattern.trim()) return formatError('MISSING_PARAM', 'pattern is required');

  let scanRoot: string;
  try {
    scanRoot = await resolveGrepScanRoot(ctx, optionalStr(params, 'path'));
  } catch (err) {
    if (err instanceof PathError) return formatError('PATH_ERROR', err.message);
    throw err;
  }

  try {
    await statFile(scanRoot);
  } catch {
    return recoverableSearchRootMissing(scanRoot);
  }

  const rgResult = await grepWithRg(params, scanRoot);
  if (rgResult !== null) return rgResult;

  return grepWithWalk(params, scanRoot);
}

export function createGrepTool(): HandlerTool {
  return createHandlerTool(ToolName.Grep, GrepToolDescription, ToolCategorySearch, grepHandler, {
    parametersSchema: grepParamsSchema
  });
}
