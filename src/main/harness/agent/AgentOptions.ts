import type { Scope } from '../types/Scope';
import type { PolicyDefaults } from '../types/PolicyDefaults';

/** 创建 Agent 实例时的参数（本轮/本角色可变属性）。 */
export interface AgentOptions {
  scope?: Scope;
  agentRoot: string;
  workspaceRoot?: string;
  sessionRoot: string;
  sharedSkillsRoot?: string;
  runtimeId?: string;
  sessionId?: string;
  agentId?: string;
  userId?: string;
  parentSessionId?: string;
  scopedChildDir?: string;
  policyDefaults?: PolicyDefaults;
  defaultModel?: string;
  defaultProvider?: string;
  defaultBaseUrl?: string;
  defaultApiKey?: string;
  defaultTemperature?: number;
  defaultThinkingLevel?: string;
  subagentModel?: string;
  subagentFlashOptimization?: boolean;
  compactionContextWindow?: number;
  compactionThresholdRatio?: number;
  compactionKeepRatio?: number;
  compactionMinMessageCount?: number;
  compactionDebug?: boolean;
  instructions?: string;
}

/** 合并 base 与 override；override 非空字段胜出。 */
export function mergeAgentOptions(base: AgentOptions, override: Partial<AgentOptions>): AgentOptions {
  const out: AgentOptions = { ...base };
  for (const [key, value] of Object.entries(override) as [keyof AgentOptions, AgentOptions[keyof AgentOptions]][]) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    (out as unknown as Record<string, unknown>)[key] = value;
  }
  return out;
}
