import fs from 'fs';
import { mkdirp } from 'mkdirp';
import path from 'path';

import { Env } from '@main/common/env';

/**
 * Thread/Agent 工作空间配置管理
 *
 * 提供两个核心目录的管理：
 *   1. threads/    - Thread 元数据存储（JSON 文件，持久化 Thread 定义）
 *   2. workspaces/ - Agent 运行时工作空间（每个 Thread 一个独立目录）
 *
 * Thread 与 Workspace 的关系：
 *   - Thread 是会话的逻辑定义（存储在 threads/{threadId}.json）
 *   - Workspace 是会话的文件系统沙箱（workspaces/{sessionId}/）
 *   - 通常 sessionId 就是 threadId，一一对应
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
   * Agent 工作空间根目录
   *
   * 每个 Thread/Session 有独立的工作空间目录（通过 getWorkspaceDir(id) 获取）。
   *
   * 工作空间结构：
   *   workspaces/{sessionId}/
   *   ├── .runtime/              系统运行时数据（Agent 不可见）
   *   │   ├── sessions/          会话持久化数据
   *   │   ├── contexts/          LLM 请求上下文快照
   *   │   ├── events/            流式事件记录
   *   │   └── logs/              Agent 运行日志
   *   └── *                      Agent 工作区（Agent 可自由创建文件/目录）
   *
   * @example
   * - 开发环境: <项目>/.home/workspaces
   * - 生产环境: ~/.coobee-agent/workspaces
   */
  get workspaces(): string {
    return path.join(this.userHome, 'workspaces');
  }

  /**
   * 获取指定 Session 的工作空间目录
   *
   * 自动创建必要的目录结构（.runtime/ 及其子目录），返回工作空间根路径。
   *
   * @param id Session ID（通常等于 Thread ID）
   * @returns 工作空间根路径 workspaces/{id}/
   *
   * @example
   * const workspace = await Threads.getWorkspaceDir('12345');
   * // 返回: /.home/workspaces/12345/
   * // 结构: 12345/
   * //       ├── .runtime/sessions/
   * //       ├── .runtime/contexts/
   * //       ├── .runtime/events/
   * //       ├── .runtime/logs/
   * //       └── (Agent 创建的文件)
   */
  async getWorkspaceDir(id: string): Promise<string> {
    const workspace = path.join(this.workspaces, id);
    const subDirs = [
      workspace,
      // 系统空间（.runtime/）
      path.join(workspace, '.runtime'),
      path.join(workspace, '.runtime', 'sessions'),
      path.join(workspace, '.runtime', 'contexts'),
      path.join(workspace, '.runtime', 'events'),
      path.join(workspace, '.runtime', 'logs')
    ];
    for (const dir of subDirs) {
      if (!fs.existsSync(dir)) {
        await mkdirp(dir);
      }
    }
    // 兼容旧工作空间：如果旧目录结构存在，迁移到新结构
    await this._migrateWorkspaceIfNeeded(workspace);
    return workspace;
  }

  /**
   * 工作空间迁移（兼容旧版本）
   *
   * 旧版本工作空间结构：
   *   workspaces/{id}/sessions/
   *   workspaces/{id}/contexts/
   *
   * 新版本结构：
   *   workspaces/{id}/.runtime/sessions/
   *   workspaces/{id}/.runtime/contexts/
   *
   * 如果检测到旧结构，自动迁移到 .runtime/ 下。
   */
  private async _migrateWorkspaceIfNeeded(workspace: string): Promise<void> {
    const runtimeDir = path.join(workspace, '.runtime');

    const runtimeMigrations = ['sessions', 'contexts', 'events', 'logs'];
    for (const name of runtimeMigrations) {
      const oldDir = path.join(workspace, name);
      const newDir = path.join(runtimeDir, name);
      if (fs.existsSync(oldDir) && !fs.existsSync(path.join(oldDir, '.migrated'))) {
        try {
          const entries = fs.readdirSync(oldDir);
          for (const entry of entries) {
            const src = path.join(oldDir, entry);
            const dst = path.join(newDir, entry);
            if (!fs.existsSync(dst)) {
              fs.renameSync(src, dst);
            }
          }
          fs.writeFileSync(path.join(oldDir, '.migrated'), 'migrated to .runtime/', 'utf-8');
        } catch {
          // 迁移失败时静默，不阻塞正常流程
        }
      }
    }
  }
}

export const Threads = new ThreadsConfig();
