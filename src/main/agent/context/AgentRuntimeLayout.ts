import fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '@main/common/logger';
import { Env } from '@main/common/env';

const log = createLogger('agent-runtime-layout');

export interface AgentRuntimeLayout {
  agentId: string;
  sessionId: string;
  agentHomePath: string;
  agentWorkspacePath: string;
  dataDirectory: string;
  sessionRoot: string;
  sessionDir: string;
  sessionFilesDir: string;
  agentSkillsPath: string;
}

export interface ResolveAgentRuntimeLayoutOptions {
  agentId: string;
  sessionId: string;
  agentHomePath?: string;
  userAgentsDir?: string;
}

export function createAgentRuntimeLayout(options: ResolveAgentRuntimeLayoutOptions): AgentRuntimeLayout {
  const { agentId, sessionId } = options;
  if (!agentId || !agentId.trim()) {
    throw new Error('[AgentRuntimeLayout] agentId is required');
  }
  if (!sessionId || !sessionId.trim()) {
    throw new Error('[AgentRuntimeLayout] sessionId is required');
  }

  const agentHomePath = options.agentHomePath || path.join(options.userAgentsDir || Env.paths.userAgentsDir, agentId);
  const agentWorkspacePath = path.join(agentHomePath, 'workspace');
  const sessionRoot = path.join(agentHomePath, 'sessions');
  const sessionDir = path.join(sessionRoot, sessionId);

  return {
    agentId,
    sessionId,
    agentHomePath,
    agentWorkspacePath,
    dataDirectory: agentWorkspacePath,
    sessionRoot,
    sessionDir,
    sessionFilesDir: path.join(sessionDir, 'sessions'),
    agentSkillsPath: path.join(agentHomePath, 'skills')
  };
}

export async function ensureAgentRuntimeLayout(options: ResolveAgentRuntimeLayoutOptions): Promise<AgentRuntimeLayout> {
  const layout = createAgentRuntimeLayout(options);
  await Promise.all([
    fsp.mkdir(layout.agentHomePath, { recursive: true }),
    fsp.mkdir(layout.agentWorkspacePath, { recursive: true }),
    fsp.mkdir(layout.sessionRoot, { recursive: true }),
    fsp.mkdir(layout.sessionDir, { recursive: true }),
    fsp.mkdir(layout.sessionFilesDir, { recursive: true }),
    fsp.mkdir(layout.agentSkillsPath, { recursive: true })
  ]);
  return layout;
}

export function ensureAgentRuntimeLayoutSync(options: ResolveAgentRuntimeLayoutOptions): AgentRuntimeLayout {
  const layout = createAgentRuntimeLayout(options);
  fs.mkdirSync(layout.agentHomePath, { recursive: true });
  fs.mkdirSync(layout.agentWorkspacePath, { recursive: true });
  fs.mkdirSync(layout.sessionRoot, { recursive: true });
  fs.mkdirSync(layout.sessionDir, { recursive: true });
  fs.mkdirSync(layout.sessionFilesDir, { recursive: true });
  fs.mkdirSync(layout.agentSkillsPath, { recursive: true });
  return layout;
}

export function resolveThreadRuntimeLayoutSync(sessionId: string, fallbackAgentId?: string): AgentRuntimeLayout {
  const thread = readThreadDefinitionSync(sessionId);
  const agentId = typeof thread?.agentId === 'string' && thread.agentId ? thread.agentId : fallbackAgentId;

  if (!agentId) {
    throw new Error(`[AgentRuntimeLayout] Cannot resolve agentId for session ${sessionId}`);
  }

  const agentHomePath =
    typeof thread?.agentHomePath === 'string' && thread.agentHomePath
      ? thread.agentHomePath
      : path.join(Env.paths.userAgentsDir, agentId);

  return ensureAgentRuntimeLayoutSync({
    agentId,
    sessionId,
    agentHomePath
  });
}

export async function migrateLegacyAgentDataDirectory(agentId: string, targetDir: string): Promise<void> {
  const legacyDir = path.join(Env.paths.userHome, 'data', agentId);
  await moveDirectoryEntries(legacyDir, targetDir, 'agent data');
}

export async function migrateLegacyThreadWorkspace(sessionId: string, targetDir: string): Promise<void> {
  const legacyDir = path.join(Env.paths.userHome, 'workspaces', sessionId);
  await moveDirectoryEntries(legacyDir, targetDir, 'thread workspace');
}

async function moveDirectoryEntries(sourceDir: string, targetDir: string, label: string): Promise<void> {
  if (path.resolve(sourceDir) === path.resolve(targetDir)) return;
  if (!fs.existsSync(sourceDir)) return;

  await fsp.mkdir(targetDir, { recursive: true });
  const entries = await fsp.readdir(sourceDir);

  for (const entry of entries) {
    const from = path.join(sourceDir, entry);
    const to = path.join(targetDir, entry);

    if (fs.existsSync(to)) {
      const [fromStat, toStat] = await Promise.all([fsp.stat(from), fsp.stat(to)]);
      if (fromStat.isDirectory() && toStat.isDirectory()) {
        await moveDirectoryEntries(from, to, label);
        continue;
      }
      log.warn(`[AgentRuntimeLayout] Skip existing ${label} entry during migration: ${to}`);
      continue;
    }

    try {
      await fsp.rename(from, to);
    } catch (error) {
      await fsp.cp(from, to, { recursive: true });
      await fsp.rm(from, { recursive: true, force: true });
      log.warn(`[AgentRuntimeLayout] Copied ${label} entry after rename failed: ${from} -> ${to}`, error);
    }
  }

  await removeIfEmpty(sourceDir);
}

async function removeIfEmpty(dirPath: string): Promise<void> {
  try {
    const remaining = await fsp.readdir(dirPath);
    if (remaining.length === 0) {
      await fsp.rmdir(dirPath);
    }
  } catch {
    // Best effort cleanup only.
  }
}

function readThreadDefinitionSync(sessionId: string): Record<string, unknown> | null {
  const filePath = path.join(Env.paths.threadsDir, `${sessionId}.json`);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}
