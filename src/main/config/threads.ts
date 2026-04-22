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
   *   ├── sessions/          SDK 会话文件目录
   *   │   ├── session.jsonl      (OpenAI)
   *   │   └── {timestamp}_{uuid}.jsonl  (PiMono)
   *   ├── history.jsonl      前端展示（聚合）
   *   ├── events.jsonl       调试事件流
   *   ├── context.jsonl      上下文快照（追加式）
   *   └── tasks/             多 Agent 协作区
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
   * 自动创建工作空间根目录和 sessions 子目录。
   *
   * @param id Session ID（通常等于 Thread ID）
   * @returns 工作空间根路径 workspaces/{id}/
   *
   * @example
   * const workspace = await Threads.getWorkspaceDir('12345');
   * // 返回: /.home/workspaces/12345/
   * // 结构: 12345/
   * //       ├── sessions/
   * //       ├── history.jsonl
   * //       ├── events.jsonl
   * //       └── context.jsonl
   */
  async getWorkspaceDir(id: string): Promise<string> {
    const workspace = path.join(this.workspaces, id);
    const sessionsDir = path.join(workspace, 'sessions');
    
    // 创建必要的目录
    if (!fs.existsSync(workspace)) {
      await mkdirp(workspace);
    }
    if (!fs.existsSync(sessionsDir)) {
      await mkdirp(sessionsDir);
    }
    
    return workspace;
  }
}

export const Threads = new ThreadsConfig();
