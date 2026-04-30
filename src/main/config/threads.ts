import path from 'path';

import { Env } from '@main/common/env';

/**
 * Thread/Agent 工作空间配置管理
 *
 * 提供两个核心目录的管理：
 *   1. threads/    - Thread 元数据存储（JSON 文件，持久化 Thread 定义）
 *   2. Agent 会话产物目录现在由 AgentRuntimeLayout 管理：
 *      agents/{agentId}/sessions/{threadId}
 *
 * Thread 与 Workspace 的关系：
 *   - Thread 是会话的逻辑定义（存储在 threads/{threadId}.json）
 *   - Agent workspace 是业务工作区：agents/{agentId}/workspace
 *   - Session dir 是会话产物目录：agents/{agentId}/sessions/{threadId}
 */
class ThreadsConfig {
  private get userHome() {
    return Env.paths.userHome;
  }

  /**
   * Thread 元数据存储目录
   *
   * 存储格式：{threads}/{threadId}.json
   *   - threadId: Snowflake ID（有序，可按 ID 排序得到时间顺序）
   *   - 内容：Thread 定义（agentId, status, createdAt, updatedAt 等）
   *
   * @example
   * - 开发环境: <项目>/.home/threads
   * - 生产环境: ~/.coobee-agent/threads
   */
  get threads(): string {
    return path.join(this.userHome, 'threads');
  }

  /**
   * @deprecated 旧 Thread workspace 根目录，仅用于一次性迁移，不再作为运行期路径。
   */
  get workspaces(): string {
    return path.join(this.userHome, 'workspaces');
  }

  /**
   * @deprecated 使用 AgentRuntimeLayout。运行期不再创建 .home/workspaces/{threadId}。
   */
  async getWorkspaceDir(_id: string): Promise<string> {
    throw new Error('[ThreadsConfig] getWorkspaceDir is deprecated. Use AgentRuntimeLayout.');
  }
}

export const Threads = new ThreadsConfig();
