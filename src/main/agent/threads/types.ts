/**
 * Thread（会话线程）类型定义
 *
 * Thread 是用户与 Agent 之间的一次完整对话会话。
 * 持久化到 .home/threads/{threadId}.json，ID 使用 Snowflake 算法生成（有序）。
 *
 * 设计：
 *   - threadId 采用 Snowflake ID，天然有序，按 ID 降序 = 按时间降序
 *   - threadId = sessionId（统一标识，workspace 目录以此命名）
 *   - 每个 Thread 绑定一个 agentId（哪个智能体在处理）
 *   - status 表示会话状态：active / archived / deleted
 *   - runStatus 跟踪运行时状态（idle / running / completed / error）
 *   - 文件存储，重启后保留
 */

import type { AgentMode } from '../runtime/types';

// ==================== Thread 运行时状态 ====================

/** Thread 运行时状态（跟踪当前执行进度） */
export type ThreadRunStatus = 'idle' | 'running' | 'completed' | 'error';

// ==================== Thread 定义 ====================

/** Thread 状态 */
export type ThreadStatus = 'active' | 'archived' | 'deleted';

/** Thread 完整定义（持久化到 .home/threads/{id}.json） */
export interface ThreadDefinition {
  /** 唯一标识（Snowflake ID，字符串形式） */
  id: string;

  /** 显示标题（通常从第一条用户消息截取，或用户手动修改） */
  title: string;

  /** 关联的 Agent ID（哪个智能体处理此会话） */
  agentId: string;

  /** Agent 名称（从 Agent 配置中获取，用于展示） */
  agentName?: string;

  /** 会话状态 */
  status: ThreadStatus;

  /** 会话 ID（等于 threadId，workspace 以此命名） */
  sessionId: string;

  /** Agent 运行模式 */
  agentMode: AgentMode;

  /** 运行时状态（跟踪当前执行进度） */
  runStatus: ThreadRunStatus;

  /** Agent Home 目录路径（用于前端展示 Agent 持久化数据） */
  agentHomePath: string;

  /** 创建时间（ISO 8601） */
  createdAt: string;

  /** 最后更新时间（ISO 8601） */
  updatedAt: string;

  /** 任务级别的模型覆盖（优先于 Agent 默认模型） */
  overrideModel?: string;

  /** 扩展元数据（保留字段） */
  metadata?: Record<string, unknown>;
}

// ==================== 索引条目（轻量级列表用） ====================

/** Thread 索引条目（用于 list 操作） */
export interface ThreadIndexEntry {
  id: string;
  title: string;
  agentId: string;
  agentName?: string;
  status: ThreadStatus;
  runStatus: ThreadRunStatus;
  createdAt: string;
  updatedAt: string;
  /** 该 Thread 的工作空间绝对路径（= workspacesDir/{id}） */
  workspacePath: string;
  /** Agent Home 目录路径（用于前端展示 Agent 持久化数据） */
  agentHomePath: string;
  /** 任务级别的模型覆盖（优先于 Agent 默认模型） */
  overrideModel?: string;
}

// ==================== 创建 / 更新参数 ====================

/** 创建 Thread 的输入参数 */
export interface CreateThreadParams {
  /** 显示标题 */
  title: string;
  /** 关联的 Agent ID */
  agentId: string;
  /** Agent 运行模式（默认 'agent'） */
  agentMode?: AgentMode;
  /** 任务级别的模型覆盖（优先于 Agent 默认模型） */
  overrideModel?: string;
  /** 扩展元数据（可选） */
  metadata?: Record<string, unknown>;
}

/** 更新 Thread 的输入参数（部分更新） */
export interface UpdateThreadParams {
  title?: string;
  status?: ThreadStatus;
  runStatus?: ThreadRunStatus;
  overrideModel?: string;
  metadata?: Record<string, unknown>;
}
