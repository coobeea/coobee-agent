/**
 * Agent Project Migration Hook
 *
 * 将旧的 `.home/agents/{agentId}/workspace` 一次性迁移到
 * `.home/agents/{agentId}/project`，避免运行期仍然暴露 workspace 命名。
 */

import { LifecyclePhase, type LifecycleContext, type LifecycleHook } from '@main/common/types';
import { log } from '@main/common/logger';

export const ReadyAgentProjectMigrationHook: LifecycleHook = {
  name: 'ready-agent-project-migration',
  phase: LifecyclePhase.READY,
  priority: 40,
  critical: true,

  async execute(_context: LifecycleContext): Promise<void> {
    const { migrateAllAgentWorkspacesToProjects } = await import('@main/agent/context/AgentProjectMigration');
    const result = await migrateAllAgentWorkspacesToProjects();

    if (result.skippedByFlag) {
      log.info(`[ReadyAgentProjectMigrationHook] 已完成过 project 目录迁移: ${result.flagPath}`);
      return;
    }

    log.info(
      `[ReadyAgentProjectMigrationHook] project 目录迁移完成: scanned=${result.scanned}, migrated=${result.migrated}`
    );
  }
};
