/** 工具分类，用于注册表分组与策略路由。 */
export type ToolCategory = 'file_system' | 'search' | 'execute' | 'extension' | 'observability' | 'discovery';

export const ToolCategoryFileSystem: ToolCategory = 'file_system';
export const ToolCategorySearch: ToolCategory = 'search';
export const ToolCategoryExecute: ToolCategory = 'execute';
export const ToolCategoryExtension: ToolCategory = 'extension';
export const ToolCategoryObservability: ToolCategory = 'observability';
export const ToolCategoryDiscovery: ToolCategory = 'discovery';

/** 内置工具名称常量（与模型 tools[].function.name 一致）。 */
export const ToolName = {
  Read: 'read',
  Write: 'write',
  Edit: 'edit',
  Exec: 'exec',
  Process: 'process',
  Search: 'search',
  Grep: 'grep',
  Glob: 'glob',
  SkillFind: 'skill_find',
  Todos: 'todos',
  EmitEvent: 'emit_event',
  SpawnSubagent: 'spawn_subagent'
} as const;

export type BuiltinToolName = (typeof ToolName)[keyof typeof ToolName];

export const BuiltinToolNames: readonly BuiltinToolName[] = [
  ToolName.Read,
  ToolName.Write,
  ToolName.Edit,
  ToolName.Exec,
  ToolName.Process,
  ToolName.Search,
  ToolName.Grep,
  ToolName.Glob,
  ToolName.SkillFind,
  ToolName.Todos,
  ToolName.EmitEvent,
  ToolName.SpawnSubagent
];

export interface ToolError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ToolResult {
  success: boolean;
  llmContent?: string;
  userContent?: string;
  error?: ToolError;
  metadata?: Record<string, unknown>;
}

export type StreamUpdateType = 'progress' | 'output';

export interface StreamUpdate {
  type: StreamUpdateType;
  content: string;
  percentage?: number;
}
