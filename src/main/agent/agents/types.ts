/**
 * Agent 类型定义
 */

/** Agent 创建来源 */
export type AgentCreatedBy = 'user' | 'agent' | 'system';

/** Agent 索引条目（轻量版，用于列表展示） */
export interface AgentIndexEntry {
  id: string;
  name: string;
  description: string;
  createdBy: AgentCreatedBy;
  version: number;
  updatedAt: string;
  /** 关联的技能 */
  skills?: string[];
  /** 使用的模型 ID 或模型组引用（@group:xxx） */
  model?: string;
  /** Agent 家目录路径（包含人格文件、技能等） */
  agentHomePath?: string;
  /** Agent 工作空间路径（任务运行时产生的文件） */
  workspacePath?: string;
}

/** Agent 完整定义（保存到文件） */
export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  /** 系统提示词 */
  instructions: string;
  /** 排除的工具列表（黑名单模式） */
  excludeTools?: string[];
  /** 关联的技能 */
  skills?: string[];
  /** 使用的模型 */
  model?: string;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
  /** 创建来源 */
  createdBy: AgentCreatedBy;
  /** 版本号（每次更新自动递增） */
  version: number;
  /** 扩展元数据 */
  metadata?: Record<string, unknown>;
}

/** 创建 Agent 参数 */
export interface CreateAgentParams {
  id: string;
  name: string;
  description: string;
  instructions: string;
  excludeTools?: string[];
  skills?: string[];
  model?: string;
  createdBy?: AgentCreatedBy;
  metadata?: Record<string, unknown>;
}

/** 更新 Agent 参数（部分更新） */
export interface UpdateAgentParams {
  name?: string;
  description?: string;
  instructions?: string;
  excludeTools?: string[];
  skills?: string[];
  model?: string;
  metadata?: Record<string, unknown>;
}
