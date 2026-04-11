import { is } from '@electron-toolkit/utils';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import { Env } from '@main/common/env';

/**
 * Agent 相关配置
 */
class AgentsConfig {
  private get userHome() {
    return Env.paths.userHome;
  }

  /**
   * 内置 Agent 目录（只读，随应用分发）
   *
   * 开发模式：项目根目录 agents/
   * 生产模式：resources/agents
   *
   * @example 开发: <项目>/agents
   */
  get builtin(): string {
    return is.dev ? path.join(app.getAppPath(), 'agents') : path.join(process.resourcesPath, 'agents');
  }

  /**
   * 用户 Agent 目录（可读写，用户自行创建/修改）
   *
   * Agent 多级合并优先级（后者覆盖前者同 ID）：
   *   1. builtin  — 内置（最低）
   *   2. user     — 用户级（最高）
   *
   * 每个 Agent 一个 JSON 文件：{agentsDir}/{agentId}.json
   *
   * @example 开发: <项目>/.home/agents | 生产: ~/.coobee-agent/agents
   */
  get user(): string {
    return path.join(this.userHome, 'agents');
  }

  /**
   * Agent Home 总根目录
   *
   * 每个 Agent 拥有独立的持久化目录，跨会话保留身份、记忆、规则：
   *   homes/{agentId}/
   *   ├── SOUL.md          人格与价值观
   *   ├── IDENTITY.md      身份名片
   *   ├── USER.md          主人档案
   *   ├── NOTES.md         环境工具备注
   *   ├── AGENTS.md        Agent 级规则
   *   ├── HEARTBEAT.md     心跳任务清单
   *   ├── MEMORY.md        长期记忆精华
   *   ├── BOOTSTRAP.md     首次引导脚本（完成后自删除）
   *   └── memory/          每日对话日志
   *
   * @example 开发: <项目>/.home/homes | 生产: ~/.coobee-agent/homes
   */
  get homes(): string {
    return path.join(this.userHome, 'homes');
  }

  /**
   * 获取指定 Agent 的 Home 目录，首次访问时自动初始化
   *
   * Agent Home 是 Agent 的持久化空间（跨会话保留），包含：
   *   SOUL.md / IDENTITY.md / USER.md / NOTES.md / AGENTS.md
   *   HEARTBEAT.md / MEMORY.md / BOOTSTRAP.md
   *
   * @param agentId Agent 唯一标识
   * @returns Home 目录绝对路径
   */
  getHomeDir(agentId: string): string {
    const homeDir = path.join(this.homes, agentId);
    if (!fs.existsSync(homeDir)) {
      fs.mkdirSync(homeDir, { recursive: true });
    }
    return homeDir;
  }
}

export const Agents = new AgentsConfig();
