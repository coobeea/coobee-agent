import { is } from '@electron-toolkit/utils';
import { app } from 'electron';
import fs from 'fs';
import { mkdirp } from 'mkdirp';
import path from 'path';

import { Env } from '@main/common/env';

/**
 * Skill 相关配置
 */
class SkillsConfig {
  private get userHome() {
    return Env.paths.userHome;
  }

  /**
   * 内置 Skill 目录（只读，随应用分发）
   *
   * 开发模式：项目根目录 skills/
   * 生产模式：resources/skills
   *
   * @example 开发: <项目>/skills
   */
  get builtin(): string {
    return is.dev ? path.join(app.getAppPath(), 'skills') : path.join(process.resourcesPath, 'skills');
  }

  /**
   * 用户 Skill 目录（可读写，用户自行安装/编写）
   *
   * Skill 多级合并优先级（后者覆盖前者同名）：
   *   1. builtin           — 内置（最低）
   *   2. user              — 用户级
   *   3. {workspace}/skills — Agent 自生成（最高，仅当前 Agent 可见）
   *
   * @example 开发: <项目>/.home/skills | 生产: ~/.coobee-agent/skills
   */
  get user(): string {
    return path.join(this.userHome, 'skills');
  }

  /**
   * 获取 Skill 搜索路径列表（按优先级从低到高）
   *
   * 合并策略：同名 Skill 后者覆盖前者
   *   1. builtin              — 内置（最低优先级）
   *   2. user                 — 用户级
   *   3. {agentHome}/skills   — Agent 级（Agent 专属技能）
   *   4. {workspace}/skills   — 工作空间级（最高优先级，仅当前会话可见）
   *
   * Agent 级 Skill 用于 Agent 专属技能（如"增值税助手"的税务 Skill）。
   * 同时确保所有 Skill 目录存在。
   *
   * @param workspace 当前工作空间路径（可选）
   * @param agentHome Agent Home 路径（可选，如果指定则加载 Agent 级 Skill）
   */
  async getSearchPaths(workspace?: string, agentHome?: string): Promise<string[]> {
    // 导入 Sessions 配置（避免循环依赖）
    const { Sessions } = await import('./sessions');

    const coreDirs = [this.userHome, Env.paths.configDir, Sessions.workspaces, this.user];
    const skillPaths = [this.builtin, this.user];

    // Agent 级 Skills（如果有 agentHome）
    if (agentHome) {
      const agentSkills = path.join(agentHome, 'skills');
      coreDirs.push(agentSkills);
      skillPaths.push(agentSkills);
    }

    // 工作空间级 Skills（优先级最高）
    if (workspace) {
      const wsSkills = path.join(workspace, 'skills');
      coreDirs.push(wsSkills);
      skillPaths.push(wsSkills);
    }

    for (const dir of coreDirs) {
      if (!fs.existsSync(dir)) {
        await mkdirp(dir);
      }
    }
    return skillPaths;
  }
}

export const Skills = new SkillsConfig();
