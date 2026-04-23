/**
 * @deprecated CoreSkills 强制注入机制已废弃。
 *
 * 当前 Skill 机制由 Agent 配置、Extension 贡献目录、用户目录和 workspace
 * 目录共同决定；本文件仅为旧代码迁移保留。新代码不要依赖 CORE_SKILLS
 * 或 ensureCoreSkills()。
 */

import { createLogger } from '@main/common/logger';
import { SkillManager } from '../SkillManager';
import type { SkillDefinition } from '../../runtime/types';

const log = createLogger('legacy-core-skills');

/**
 * 历史核心技能名称列表，仅用于兼容旧数据或迁移脚本。
 */
export const CORE_SKILLS = [
  'execution-protocol',
  'self-reflection',
  'eval-refine-loop',
  'brain',
  'dimension-architect'
] as const;

/**
 * @deprecated 不再强制注入核心技能。新代码应直接使用 Agent 配置中的 skills。
 */
export function ensureCoreSkills(skills: string[]): string[] {
  const result = [...skills];

  for (const s of [...CORE_SKILLS].reverse()) {
    if (!result.includes(s)) {
      result.unshift(s);
    }
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ExtensionManager } = require('@main/common/extension');
    const registry = ExtensionManager.getRegistry();
    if (registry) {
      const autoInjectSkills = registry.getAutoInjectSkills();
      const insertIdx = CORE_SKILLS.length;
      for (const skill of autoInjectSkills.reverse()) {
        if (!result.includes(skill)) {
          result.splice(insertIdx, 0, skill);
        }
      }
    }
  } catch {
    // Extension 系统未初始化时忽略
  }

  return result;
}

/**
 * @deprecated 不再为动态 Agent 隐式加载核心技能。保留给旧调用方迁移。
 */
export function loadCoreSkillDefinitions(): SkillDefinition[] {
  try {
    // 延迟 require 避免循环依赖
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Env } = require('@main/common/env');
    const searchPaths = [Env.paths.builtinSkillsDir, Env.paths.userSkillsDir];
    const secretsDir = Env.paths.secretsDir;

    const manager = new SkillManager();
    manager.scanSkills(searchPaths, secretsDir);

    const result: SkillDefinition[] = [];
    for (const name of CORE_SKILLS) {
      const skill = manager.getByName(name);
      if (skill) {
        result.push(skill);
      } else {
        log.warn(`[CoreSkills] Legacy core skill not found: ${name}`);
      }
    }

    log.info(`[CoreSkills] Loaded ${result.length}/${CORE_SKILLS.length} legacy core skills`);
    return result;
  } catch (err) {
    log.error('[CoreSkills] Failed to load legacy core skills:', err);
    return [];
  }
}
