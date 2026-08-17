/**
 * 智能体在本轮 Run 中的编排角色/范围（不是 AgentID）。
 * 空串表示主 session 单 Agent Turn。
 */
export type Scope = '' | 'subagent' | 'member' | 'host';

export const ScopeSubagent: Scope = 'subagent';
export const ScopeMember: Scope = 'member';
export const ScopeHost: Scope = 'host';

/** 限制工具仅对默认单 Agent Turn 与 expert_team 主持人可见。 */
export const AudienceDefaultAndHost: readonly Scope[] = ['', ScopeHost];

export function isKnownScope(scope: string): boolean {
  return scope === ScopeSubagent || scope === ScopeMember || scope === ScopeHost;
}
