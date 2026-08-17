import path from 'node:path';
import { readdir } from 'node:fs/promises';
import type { ExecContext } from '../definition/Tool';
import type { StreamUpdate, ToolResult } from '../../types/ToolTypes';
import { SkipDirNames } from '../../types/Constants';
import { ToolCategorySearch, ToolName } from '../../types/ToolTypes';
import { PathError, guard, normalizePath } from '../path/PathGuard';
import { createHandlerTool, type HandlerTool } from './HandlerTool';
import { searchParamsSchema } from './schemas';
import { SearchToolDescription } from './descriptions';
import { formatError, optionalBool, optionalInt, optionalStr, strParam, successResult, workspaceCwd } from './helpers';
import { recoverableContentEmpty, recoverableSearchRootMissing } from './recoverable';
import { isBinaryFile, readFileLimited, statFile } from './io';

const SEARCH_DEFAULT_MAX = 50;
const SEARCH_MAX_RESULTS = 200;
const SEARCH_MAX_FILES = 2000;
const SEARCH_MAX_FILE_SIZE = 2 * 1024 * 1024;

interface SearchMatch {
  file: string;
  line: number;
  content: string;
}

async function resolveSearchRoot(ctx: ExecContext, searchPath?: string): Promise<string> {
  if (!searchPath?.trim()) {
    const root = workspaceCwd(ctx);
    return path.normalize(root);
  }
  const abs = normalizePath(searchPath, ctx);
  guard(abs, ctx, searchPath);
  return abs;
}

function createGlobTest(globFilter: string): (filePath: string) => boolean {
  const normalized = globFilter.replace(/^\*\//, '');
  if (globFilter.startsWith('*.')) {
    const ext = globFilter.slice(1);
    return (filePath: string) => filePath.endsWith(ext);
  }
  return (filePath: string) => {
    const base = path.basename(filePath);
    return base === normalized || filePath.endsWith(`/${normalized}`);
  };
}

async function collectSearchFiles(
  dir: string,
  files: string[],
  globTest: ((filePath: string) => boolean) | undefined,
  maxFiles: number
): Promise<void> {
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
      await collectSearchFiles(full, files, globTest, maxFiles);
      continue;
    }
    if (entry.name === 'config.yaml') continue;
    if (!globTest || globTest(full)) files.push(full);
  }
}

async function searchHandler(
  ctx: ExecContext,
  params: Record<string, unknown>,
  _onUpdate?: (update: StreamUpdate) => void
): Promise<ToolResult> {
  if (!ctx.workspaceRoot && !ctx.agentRoot) {
    return formatError('NO_WORKSPACE', 'project not available');
  }

  const pattern = strParam(params, 'pattern');
  if (!pattern.trim()) return formatError('MISSING_PARAM', 'pattern is required');

  let maxResults = optionalInt(params, 'maxResults') ?? SEARCH_DEFAULT_MAX;
  if (maxResults > SEARCH_MAX_RESULTS) maxResults = SEARCH_MAX_RESULTS;

  let scanRoot: string;
  try {
    scanRoot = await resolveSearchRoot(ctx, optionalStr(params, 'searchPath'));
  } catch (err) {
    if (err instanceof PathError) return formatError('PATH_ERROR', err.message);
    throw err;
  }

  try {
    await statFile(scanRoot);
  } catch {
    return recoverableSearchRootMissing(scanRoot);
  }

  const caseSensitive = optionalBool(params, 'caseSensitive') ?? false;
  let re: RegExp;
  try {
    re = new RegExp(caseSensitive ? pattern : `(?i)${pattern}`);
  } catch (err) {
    return formatError(
      'INVALID_PATTERN',
      `invalid regex pattern ${JSON.stringify(pattern)}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const globParam = optionalStr(params, 'glob');
  const globTest = globParam ? createGlobTest(globParam) : undefined;

  const files: string[] = [];
  const rootStat = await statFile(scanRoot);
  if (rootStat.isFile()) {
    if (path.basename(scanRoot) !== 'config.yaml') files.push(scanRoot);
  } else {
    await collectSearchFiles(scanRoot, files, globTest, SEARCH_MAX_FILES);
  }

  const matches: SearchMatch[] = [];
  for (const filePath of files) {
    if (matches.length >= maxResults) break;
    let fileStat;
    try {
      fileStat = await statFile(filePath);
    } catch {
      continue;
    }
    if (!fileStat.isFile() || fileStat.size > SEARCH_MAX_FILE_SIZE) continue;
    if (await isBinaryFile(filePath)) continue;

    let data: Buffer;
    try {
      data = await readFileLimited(filePath, SEARCH_MAX_FILE_SIZE);
    } catch {
      continue;
    }

    const lines = data.toString('utf8').split('\n');
    const absFile = path.normalize(filePath);
    for (let i = 0; i < lines.length; i++) {
      if (matches.length >= maxResults) break;
      const line = lines[i]!;
      if (re.test(line)) {
        let content = line;
        if (content.length > 200) content = `${content.slice(0, 200)}...`;
        matches.push({ file: absFile, line: i + 1, content });
      }
    }
  }

  if (matches.length === 0) {
    const r = recoverableContentEmpty(pattern, scanRoot);
    return { success: r.success, llmContent: r.llmContent };
  }

  const body = matches.map((m) => `${m.file}:${m.line}: ${m.content}`).join('\n');
  return successResult(`Found ${matches.length} match(es) for ${JSON.stringify(pattern)}:\n\n${body}`);
}

export function createSearchTool(): HandlerTool {
  return createHandlerTool(ToolName.Search, SearchToolDescription, ToolCategorySearch, searchHandler, {
    parametersSchema: searchParamsSchema
  });
}
