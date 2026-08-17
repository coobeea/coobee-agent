import path from 'node:path';
import type { ExecContext } from '../definition/Tool';
import { PathBlacklist, PathBlacklistSegment } from '../../types/Constants';

const WORKSPACE_WIRE_PREFIX = '@workspace/';

export class PathError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'PathError';
  }
}

/** Strips wire tokens from LLM path args. */
export function sanitizeToolPathInput(filePath: string, workspaceRoot: string): string {
  const p = filePath.trim();
  if (p.startsWith(WORKSPACE_WIRE_PREFIX)) {
    const rel = p.slice(WORKSPACE_WIRE_PREFIX.length).replace(/^\//, '');
    if (workspaceRoot) {
      return path.join(workspaceRoot, rel);
    }
    return rel;
  }
  return p;
}

/** Resolves tool path to absolute (relative paths anchor agentRoot). */
export function normalizePath(filePath: string, ctx: ExecContext): string {
  const p = sanitizeToolPathInput(filePath, ctx.workspaceRoot).trim();
  if (!p) {
    throw new PathError('MISSING_PARAM', 'path is required');
  }
  if (path.isAbsolute(p)) {
    return path.normalize(p);
  }
  if (!ctx.agentRoot) {
    throw new PathError('PATH_ERROR', 'agent root is required for relative paths');
  }
  return path.normalize(path.join(ctx.agentRoot, p));
}

/** Reports whether path is root or inside root. */
export function pathUnderRoot(target: string, root: string): boolean {
  const cleanedRoot = path.normalize(root);
  const cleanedTarget = path.normalize(target);
  if (cleanedTarget === cleanedRoot) {
    return true;
  }
  const rel = path.relative(cleanedRoot, cleanedTarget);
  return rel !== '..' && !rel.startsWith(`..${path.sep}`);
}

/** Reports whether a resolved absolute path hits the sandbox blacklist. */
export function isForbiddenToolPath(absolutePath: string): boolean {
  const target = path.normalize(absolutePath);
  if (target.includes(PathBlacklistSegment)) {
    return true;
  }
  for (const blocked of PathBlacklist) {
    if (pathUnderRoot(target, blocked)) {
      return true;
    }
  }
  return false;
}

function validateSandboxPath(originalInput: string, absolutePath: string): void {
  if (isForbiddenToolPath(absolutePath)) {
    throw new PathError('PATH_ESCAPE', `path not allowed: ${originalInput}`);
  }
}

/** Rejects paths that hit the tool sandbox blacklist. */
export function guard(absPath: string, _ctx: ExecContext, originalInput?: string): void {
  validateSandboxPath(originalInput ?? absPath, absPath);
}
