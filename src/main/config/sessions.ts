import fs from 'fs';
import { mkdirp } from 'mkdirp';
import path from 'path';

import { Env } from '@main/common/env';

/**
 * 会话相关配置
 */
class SessionsConfig {
  private get userHome() {
    return Env.paths.userHome;
  }

  /**
   * 会话线程存储目录
   *
   * 每个 Thread 一个 JSON 文件：{threadsDir}/{threadId}.json
   * threadId 使用 Snowflake ID（有序，可按 ID 排序得到时间顺序）。
   *
   * @example 开发: <项目>/.home/threads | 生产: ~/.coobee-agent/threads
   */
  get threads(): string {
    return path.join(this.userHome, 'threads');
  }

  /**
   * Agent 工作空间总根目录
   *
   * 每次会话/Agent 通过 getWorkspaceDir(id) 获取独立子目录：
   *   workspaces/{id}/
   *   ├── GOAL.md       目标文件（系统初始化，Agent 填写）
   *   ├── sessions/     会话持久化
   *   ├── contexts/     LLM 请求上下文快照
   *   ├── skills/       Agent 自生成的 Skill
   *   ├── output/       Agent 输出文件
   *   └── tasks/        多 Agent 委托任务（按需创建）
   *
   * @example 开发: <项目>/.home/workspaces | 生产: ~/.coobee-agent/workspaces
   */
  get workspaces(): string {
    return path.join(this.userHome, 'workspaces');
  }

  /**
   * 获取指定 ID 的工作空间目录，自动确保目录结构存在
   *
   * 返回 {workspaces}/{id}，id 通常为 sessionId。
   *
   * 工作空间是会话级的临时沙箱，Agent 可以自由创建文件和目录：
   *   {workspaces}/{id}/
   *   ├── GOAL.md                  目标文件（Agent 在意图提取阶段填写）
   *   ├── .runtime/                系统内部文件（LLM 运行时数据）
   *   │   ├── sessions/               会话持久化
   *   │   ├── contexts/               LLM 请求上下文快照
   *   │   ├── events/                 流式事件记录
   *   │   └── logs/                   Agent 运行日志
   *   └── tasks/                   [多 Agent] 委托任务目录（按需创建）
   *       └── {taskId}/
   *           ├── plan.md             任务计划
   *           ├── status.json         任务状态
   *           ├── agents/             子 Agent 工作空间
   *           ├── results/            子 Agent 汇总结果
   *           └── experiences/        共享执行经验
   *
   * @param id 工作空间标识（通常为 sessionId）
   * @returns 工作空间根路径
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
    // 初始化 GOAL.md（工作空间标准文件）
    const goalPath = path.join(workspace, 'GOAL.md');
    if (!fs.existsSync(goalPath)) {
      fs.writeFileSync(goalPath, '', 'utf-8');
    }
    return workspace;
  }

  /**
   * 惰性迁移旧工作空间到新结构
   *
   * 如果根目录下存在旧的 sessions/contexts/events/logs 目录，
   * 把它们移动到 .runtime/ 下。
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

export const Sessions = new SessionsConfig();
