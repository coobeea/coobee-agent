import { Env } from '@main/common/env';
import { SkillManager } from '@main/agent/skills/SkillManager';

/**
 * Skill 相关配置
 */
class SkillsConfig {
  /**
   * 内置 Skill 目录（只读，随应用分发）
   */
  get builtin(): string {
    return Env.paths.builtinSkillsDir;
  }

  /**
   * 用户 Skill 目录（可读写，用户自行安装/编写）
   */
  get user(): string {
    return Env.paths.userSkillsDir;
  }

  /**
   * 获取 Skill 搜索路径列表（按优先级从低到高）
   *
   * 实际来源、优先级和扩展贡献均由 SkillManager 统一管理。
   *
   * @param workspace 当前工作空间路径（可选）
   * @param agentHome Agent Home 路径（可选，如果指定则加载 Agent 级 Skill）
   */
  async getSearchPaths(workspace?: string, agentHome?: string): Promise<string[]> {
    const sources = await SkillManager.buildDefaultSearchPathSources({ workspace, agentHome });
    return SkillManager.searchPathsFromSources(sources);
  }
}

export const Skills = new SkillsConfig();
