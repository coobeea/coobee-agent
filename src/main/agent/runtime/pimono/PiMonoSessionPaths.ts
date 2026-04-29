import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentRuntimeOptions } from '../types';

const WORKSPACE_MANAGED_JSONL = new Set(['history.jsonl', 'events.jsonl', 'context.jsonl']);
const PI_MONO_SESSION_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z_.+\.jsonl$/;

type SessionPathOptions = Pick<AgentRuntimeOptions, 'sessionDir' | 'workspaceRoot' | 'sessionId'>;

export interface SessionMigrationLogger {
  info(message: string): void;
  warn(message: string, error?: unknown): void;
}

/**
 * PiMono 的 sessionDir 在 AgentExecutor 链路里传入的是 workspace 根目录。
 * 真正的 SDK 会话文件需要收纳到 workspace/sessions/，避免和 history/events/context 混在一起。
 */
export function resolvePiMonoSessionRoot(cwd: string, options: SessionPathOptions): string {
  const configuredSessionDir = options.sessionDir || path.join(cwd, '.coobee-test', 'sessions');

  if (
    options.workspaceRoot &&
    options.sessionDir &&
    path.resolve(options.sessionDir) === path.resolve(options.workspaceRoot)
  ) {
    return path.join(configuredSessionDir, 'sessions');
  }

  return configuredSessionDir;
}

export function isLegacyPiMonoSessionFile(fileName: string, sessionId?: string): boolean {
  if (WORKSPACE_MANAGED_JSONL.has(fileName)) return false;
  if (!PI_MONO_SESSION_FILE_PATTERN.test(fileName)) return false;

  if (!sessionId) return true;

  const safeSessionId = sessionId.replace(/:/g, '__');
  return fileName.endsWith(`_${sessionId}.jsonl`) || fileName.endsWith(`_${safeSessionId}.jsonl`);
}

export async function migrateLegacyPiMonoSessionFiles(
  workspaceRoot: string | undefined,
  sessionRoot: string,
  sessionId: string | undefined,
  logger?: SessionMigrationLogger
): Promise<void> {
  if (!workspaceRoot) return;
  if (path.resolve(workspaceRoot) === path.resolve(sessionRoot)) return;

  let entries: Array<{ name: string; isFile: () => boolean }>;
  try {
    entries = await fs.readdir(workspaceRoot, { withFileTypes: true });
  } catch (err) {
    logger?.warn(`[PiMonoSessionPaths] Failed to read workspace for session migration: ${workspaceRoot}`, err);
    return;
  }

  const legacyFiles = entries.filter((entry) => entry.isFile() && isLegacyPiMonoSessionFile(entry.name, sessionId));
  if (legacyFiles.length === 0) return;

  await fs.mkdir(sessionRoot, { recursive: true });

  for (const file of legacyFiles) {
    const from = path.join(workspaceRoot, file.name);
    const to = path.join(sessionRoot, file.name);

    try {
      await fs.rename(from, to);
      logger?.info(`[PiMonoSessionPaths] Migrated legacy session file: ${from} -> ${to}`);
    } catch (err) {
      logger?.warn(`[PiMonoSessionPaths] Failed to migrate legacy session file: ${from}`, err);
    }
  }
}
