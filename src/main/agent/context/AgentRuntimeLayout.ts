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
  agentProjectPath: string;
  projectPath: string;
  /** @deprecated Use agentProjectPath/projectPath. */
  agentWorkspacePath: string;
  sessionRoot: string;
  sessionDir: string;
  sessionFilesDir: string;
  agentSkillsPath: string;
}

export interface ResolveAgentRuntimeLayoutOptions {
  agentId: string;
  sessionId: string;
  agentHomePath?: string;
  agentsDir?: string;
}

export function createAgentRuntimeLayout(options: ResolveAgentRuntimeLayoutOptions): AgentRuntimeLayout {
  const { agentId, sessionId } = options;
  if (!agentId || !agentId.trim()) {
    throw new Error('[AgentRuntimeLayout] agentId is required');
  }
  if (!sessionId || !sessionId.trim()) {
    throw new Error('[AgentRuntimeLayout] sessionId is required');
  }

  const agentHomePath = options.agentHomePath || path.join(options.agentsDir || Env.paths.agentsDir, agentId);
  const agentProjectPath = path.join(agentHomePath, 'project');
  const sessionRoot = path.join(agentHomePath, 'sessions');
  const sessionDir = path.join(sessionRoot, sessionId);

  return {
    agentId,
    sessionId,
    agentHomePath,
    agentProjectPath,
    projectPath: agentProjectPath,
    agentWorkspacePath: agentProjectPath,
    sessionRoot,
    sessionDir,
    sessionFilesDir: path.join(sessionDir, 'sessions'),
    agentSkillsPath: path.join(agentHomePath, 'skills')
  };
}

export async function ensureAgentRuntimeLayout(options: ResolveAgentRuntimeLayoutOptions): Promise<AgentRuntimeLayout> {
  const layout = createAgentRuntimeLayout(options);
  await migrateLegacyAgentWorkspaceDirectory(layout.agentId, layout.agentHomePath, layout.agentProjectPath);
  await Promise.all([
    fsp.mkdir(layout.agentHomePath, { recursive: true }),
    fsp.mkdir(layout.agentProjectPath, { recursive: true }),
    fsp.mkdir(layout.sessionRoot, { recursive: true }),
    fsp.mkdir(layout.sessionDir, { recursive: true }),
    fsp.mkdir(layout.sessionFilesDir, { recursive: true }),
    fsp.mkdir(layout.agentSkillsPath, { recursive: true })
  ]);
  return layout;
}

export function ensureAgentRuntimeLayoutSync(options: ResolveAgentRuntimeLayoutOptions): AgentRuntimeLayout {
  const layout = createAgentRuntimeLayout(options);
  migrateLegacyAgentWorkspaceDirectorySync(layout.agentId, layout.agentHomePath, layout.agentProjectPath);
  fs.mkdirSync(layout.agentHomePath, { recursive: true });
  fs.mkdirSync(layout.agentProjectPath, { recursive: true });
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
      : path.join(Env.paths.agentsDir, agentId);

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

export async function migrateLegacyAgentWorkspaceDirectory(
  agentId: string,
  agentHomePath: string,
  targetDir: string
): Promise<void> {
  const legacyDir = path.join(agentHomePath, 'workspace');
  await moveDirectoryStrict(legacyDir, targetDir, `agent project (${agentId})`);
}

export function migrateLegacyAgentWorkspaceDirectorySync(
  agentId: string,
  agentHomePath: string,
  targetDir: string
): void {
  const legacyDir = path.join(agentHomePath, 'workspace');
  moveDirectoryStrictSync(legacyDir, targetDir, `agent project (${agentId})`);
}

export async function migrateLegacyThreadWorkspace(sessionId: string, targetDir: string): Promise<void> {
  const legacyDir = path.join(Env.paths.userHome, 'workspaces', sessionId);
  await moveDirectoryEntries(legacyDir, targetDir, 'thread workspace');
}

async function moveDirectoryStrict(sourceDir: string, targetDir: string, label: string): Promise<void> {
  if (path.resolve(sourceDir) === path.resolve(targetDir)) return;
  if (!fs.existsSync(sourceDir)) return;

  const sourceEntries = await fsp.readdir(sourceDir);
  if (sourceEntries.length === 0) {
    await fsp.rm(sourceDir, { recursive: true, force: true });
    return;
  }

  if (fs.existsSync(targetDir)) {
    const targetEntries = await fsp.readdir(targetDir);
    if (targetEntries.length > 0) {
      throw new Error(
        `[AgentRuntimeLayout] Cannot migrate ${label}: both legacy workspace and project directories contain files. legacy=${sourceDir}, project=${targetDir}`
      );
    }
    await fsp.rm(targetDir, { recursive: true, force: true });
  }

  try {
    await fsp.rename(sourceDir, targetDir);
  } catch (error) {
    await fsp.mkdir(path.dirname(targetDir), { recursive: true });
    await fsp.cp(sourceDir, targetDir, { recursive: true });
    await fsp.rm(sourceDir, { recursive: true, force: true });
    log.warn(`[AgentRuntimeLayout] Copied ${label} after rename failed: ${sourceDir} -> ${targetDir}`, error);
  }
}

function moveDirectoryStrictSync(sourceDir: string, targetDir: string, label: string): void {
  if (path.resolve(sourceDir) === path.resolve(targetDir)) return;
  if (!fs.existsSync(sourceDir)) return;

  const sourceEntries = fs.readdirSync(sourceDir);
  if (sourceEntries.length === 0) {
    fs.rmSync(sourceDir, { recursive: true, force: true });
    return;
  }

  if (fs.existsSync(targetDir)) {
    const targetEntries = fs.readdirSync(targetDir);
    if (targetEntries.length > 0) {
      throw new Error(
        `[AgentRuntimeLayout] Cannot migrate ${label}: both legacy workspace and project directories contain files. legacy=${sourceDir}, project=${targetDir}`
      );
    }
    fs.rmSync(targetDir, { recursive: true, force: true });
  }

  try {
    fs.renameSync(sourceDir, targetDir);
  } catch (error) {
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.cpSync(sourceDir, targetDir, { recursive: true });
    fs.rmSync(sourceDir, { recursive: true, force: true });
    log.warn(`[AgentRuntimeLayout] Copied ${label} after rename failed: ${sourceDir} -> ${targetDir}`, error);
  }
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
