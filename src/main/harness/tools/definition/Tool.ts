import type { Scope } from '../../types/Scope';
import type { StreamUpdate, ToolCategory, ToolResult } from '../../types/ToolTypes';
import type { EventType } from '../../event/spec/EventType';

export interface ToolDescriptor {
  name: string;
  description: string;
  category: ToolCategory;
  needUserConfirm?: boolean;
  /** 允许使用此工具的 Scope 列表；空表示所有 Scope 可见。 */
  audience?: Scope[];
}

export function visibleForAgent(descriptor: ToolDescriptor, agentScope: Scope): boolean {
  if (!descriptor.audience || descriptor.audience.length === 0) {
    return true;
  }
  return descriptor.audience.includes(agentScope);
}

/** 工具执行上下文（路径、身份、流式出站）。 */
export interface ExecContext {
  agentRoot: string;
  workspaceRoot: string;
  sessionRoot: string;
  sharedSkillsRoot?: string;
  runtimeId: string;
  agentId: string;
  userId: string;
  sessionId: string;
  runId: string;
  scope: Scope;
  toolCallId?: string;
  compactionContextWindow?: number;
  model?: string;
  provider?: string;
  streamEmit?: (type: string, content: string, data?: Record<string, unknown>) => Promise<void>;
  emitStandardEvent?: (type: EventType, content: string, data?: Record<string, unknown>) => Promise<void>;
  cwdOrWorkspace(): string;
}

export abstract class BaseExecContext implements ExecContext {
  abstract agentRoot: string;
  abstract workspaceRoot: string;
  abstract sessionRoot: string;
  sharedSkillsRoot?: string;
  abstract runtimeId: string;
  abstract agentId: string;
  abstract userId: string;
  abstract sessionId: string;
  abstract runId: string;
  abstract scope: Scope;
  toolCallId?: string;
  compactionContextWindow?: number;
  model?: string;
  provider?: string;
  streamEmit?: (type: string, content: string, data?: Record<string, unknown>) => Promise<void>;
  emitStandardEvent?: (type: EventType, content: string, data?: Record<string, unknown>) => Promise<void>;

  cwdOrWorkspace(): string {
    return this.workspaceRoot || this.agentRoot || process.cwd();
  }
}

export interface Tool {
  descriptor(): ToolDescriptor;
  execute(
    ctx: ExecContext,
    params: Record<string, unknown>,
    onUpdate?: (update: StreamUpdate) => void
  ): Promise<ToolResult>;
}

export interface RegisteredToolEntry {
  tool: Tool;
  extensionId: string;
}
