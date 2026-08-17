import path from 'node:path';
import { readdir } from 'node:fs/promises';
import type { ExecContext } from '../definition/Tool';
import type { StreamUpdate, ToolResult } from '../../types/ToolTypes';
import { SkipDirNames } from '../../types/Constants';
import { ToolCategorySearch, ToolName } from '../../types/ToolTypes';
import { PathError, guard, normalizePath } from '../path/PathGuard';
import { createHandlerTool, type HandlerTool } from './HandlerTool';
import { globParamsSchema } from './schemas';
import { GlobToolDescription } from './descriptions';
import { formatError, optionalInt, optionalStr, strParam, successResult } from './helpers';
import { recoverableGlobEmpty, recoverableSearchRootMissing } from './recoverable';
import { statFile } from './io';

const GLOB_DEFAULT_MAX = 100;
const GLOB_HARD_MAX = 500;
const GLOB_MAX_ENTRIES = 10000;

interface GlobMatch {
  absolutePath: string;
  size: number;
  modifiedAt: Date;
}

function relUnderRoot(root: string, full: string): string {
  const rel = path.relative(root, full);
  return rel.split(path.sep).join('/');
}

function globToRegex(glob: string): string {
  let out = '^';
  for (let i = 0; i < glob.length;) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 3;
        } else {
          out += '.*';
          i += 2;
        }
      } else {
        out += '[^/]*';
        i += 1;
      }
    } else if (c === '?') {
      out += '[^/]';
      i += 1;
    } else if (c === '.') {
      out += '\\.';
      i += 1;
    } else {
      out += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i += 1;
    }
  }
  return `${out}$`;
}

function compileGlobPattern(pattern: string): (relPath: string) => boolean {
  if (!pattern.includes('*') && !pattern.includes('?')) {
    return (relPath: string) => path.basename(relPath) === pattern || relPath === pattern;
  }
  if (pattern.startsWith('*.') && !pattern.includes('/') && !pattern.includes('**')) {
    const ext = pattern.slice(1);
    return (relPath: string) => relPath.endsWith(ext);
  }
  try {
    const re = new RegExp(globToRegex(pattern), 'i');
    return (relPath: string) => re.test(relPath);
  } catch {
    const stripped = pattern.replace(/[*?]/g, '');
    return (relPath: string) => relPath.includes(stripped);
  }
}

function formatGlobFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

async function walkGlobDirectory(
  dir: string,
  scanRoot: string,
  matcher: (relPath: string) => boolean,
  results: GlobMatch[],
  maxResults: number,
  entriesScanned: { count: number }
): Promise<void> {
  if (results.length >= maxResults || entriesScanned.count >= GLOB_MAX_ENTRIES) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= maxResults || entriesScanned.count >= GLOB_MAX_ENTRIES) return;
    entriesScanned.count += 1;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SkipDirNames.has(entry.name)) continue;
      await walkGlobDirectory(fullPath, scanRoot, matcher, results, maxResults, entriesScanned);
      continue;
    }
    if (!entry.isFile()) continue;
    const relPath = relUnderRoot(scanRoot, fullPath);
    if (!matcher(relPath)) continue;
    const info = await entry.stat();
    results.push({
      absolutePath: path.normalize(fullPath),
      size: info.size,
      modifiedAt: info.mtime
    });
  }
}

async function globHandler(
  ctx: ExecContext,
  params: Record<string, unknown>,
  _onUpdate?: (update: StreamUpdate) => void
): Promise<ToolResult> {
  const pattern = strParam(params, 'pattern').trim();
  if (!pattern) return formatError('MISSING_PARAM', 'pattern is required');

  let maxResults = optionalInt(params, 'maxResults') ?? GLOB_DEFAULT_MAX;
  if (maxResults > GLOB_HARD_MAX) maxResults = GLOB_HARD_MAX;

  let searchRoot = ctx.workspaceRoot;
  const searchPath = optionalStr(params, 'searchPath');
  if (searchPath) {
    try {
      const abs = normalizePath(searchPath, ctx);
      guard(abs, ctx, searchPath);
      searchRoot = abs;
    } catch (err) {
      if (err instanceof PathError) return formatError(err.code, err.message);
      throw err;
    }
  }
  if (!searchRoot) searchRoot = ctx.agentRoot;
  if (!searchRoot) return formatError('NO_WORKSPACE', 'project not available');

  try {
    await statFile(searchRoot);
  } catch {
    return recoverableSearchRootMissing(searchRoot);
  }

  const matcher = compileGlobPattern(pattern);
  const matches: GlobMatch[] = [];
  await walkGlobDirectory(searchRoot, searchRoot, matcher, matches, maxResults, { count: 0 });

  if (matches.length === 0) {
    const r = recoverableGlobEmpty(pattern, searchRoot);
    return { success: r.success, llmContent: r.llmContent };
  }

  matches.sort((a, b) => a.absolutePath.localeCompare(b.absolutePath));
  const lines = matches.map(
    (m) => `${m.absolutePath}  (${formatGlobFileSize(m.size)}, ${m.modifiedAt.toISOString().slice(0, 19)})`
  );
  const truncated = matches.length >= maxResults ? ` (truncated at ${maxResults})` : '';
  return successResult(
    `Found ${matches.length} files matching ${JSON.stringify(pattern)}${truncated}:\n\n${lines.join('\n')}`
  );
}

export function createGlobTool(): HandlerTool {
  return createHandlerTool(ToolName.Glob, GlobToolDescription, ToolCategorySearch, globHandler, {
    parametersSchema: globParamsSchema
  });
}
