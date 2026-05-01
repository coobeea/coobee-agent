import fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '@main/common/logger';
import { migrateLegacyAgentWorkspaceDirectory } from './AgentRuntimeLayout';

const log = createLogger('agent-project-migration');

export interface AgentProjectMigrationResult {
  scanned: number;
  migrated: number;
  skippedByFlag: boolean;
  flagPath: string;
}

const MIGRATION_FLAG_NAME = '.migration-agent-project-v1.json';

export async function migrateAllAgentWorkspacesToProjects(options?: {
  userHome: string;
  agentsDir: string;
}): Promise<AgentProjectMigrationResult> {
  const { Env } = await import('@main/common/env');
  const userHome = options?.userHome ?? Env.paths.userHome;
  const agentsDir = options?.agentsDir ?? Env.paths.agentsDir;
  const flagPath = path.join(userHome, MIGRATION_FLAG_NAME);

  if (fs.existsSync(flagPath)) {
    return { scanned: 0, migrated: 0, skippedByFlag: true, flagPath };
  }

  if (!fs.existsSync(agentsDir)) {
    await writeMigrationFlag(flagPath, { scanned: 0, migrated: 0 });
    return { scanned: 0, migrated: 0, skippedByFlag: false, flagPath };
  }

  const entries = await fsp.readdir(agentsDir, { withFileTypes: true });
  let scanned = 0;
  let migrated = 0;

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

    scanned += 1;
    const agentHomePath = path.join(agentsDir, entry.name);
    const legacyDir = path.join(agentHomePath, 'workspace');
    const projectDir = path.join(agentHomePath, 'project');
    const hadLegacyWorkspace = fs.existsSync(legacyDir);

    await migrateLegacyAgentWorkspaceDirectory(entry.name, agentHomePath, projectDir);

    if (hadLegacyWorkspace && fs.existsSync(projectDir) && !fs.existsSync(legacyDir)) {
      migrated += 1;
    }
  }

  await writeMigrationFlag(flagPath, { scanned, migrated });
  log.info(`[AgentProjectMigration] Completed: scanned=${scanned}, migrated=${migrated}`);

  return { scanned, migrated, skippedByFlag: false, flagPath };
}

async function writeMigrationFlag(flagPath: string, result: { scanned: number; migrated: number }): Promise<void> {
  await fsp.mkdir(path.dirname(flagPath), { recursive: true });
  await fsp.writeFile(
    flagPath,
    JSON.stringify(
      {
        version: 1,
        migratedAt: new Date().toISOString(),
        ...result
      },
      null,
      2
    ),
    'utf-8'
  );
}
