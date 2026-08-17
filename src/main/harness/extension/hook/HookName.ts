/**
 * Extension Hook 名称闭集（与 Go AllNames 对齐，共 21 个可注册）。
 */
export const HookName = {
  MessageReceived: 'message_received',
  PrepareRunInput: 'prepare_run_input',
  PrepareModelResolve: 'prepare_model_resolve',
  PrepareAgentRun: 'prepare_agent_run',
  PrepareAgentReply: 'prepare_agent_reply',
  RunStarted: 'run_started',
  TurnStarted: 'turn_started',
  TurnCompleted: 'turn_completed',
  PrepareToolCall: 'prepare_tool_call',
  TransformToolResult: 'transform_tool_result',
  TransformToolEvent: 'transform_tool_event',
  TransformReasoningEvent: 'transform_reasoning_event',
  ToolCallCompleted: 'tool_call_completed',
  PrepareAgentFinalize: 'prepare_agent_finalize',
  RunCompleted: 'run_completed',
  CompactionStarted: 'compaction_started',
  CompactionCompleted: 'compaction_completed',
  PrepareSubagentSpawn: 'prepare_subagent_spawn',
  PrepareSubagentDelivery: 'prepare_subagent_delivery',
  SubagentSpawned: 'subagent_spawned',
  SubagentEnded: 'subagent_ended'
} as const;

export type HookNameValue = (typeof HookName)[keyof typeof HookName];

/** 保留名，不得注册实现。 */
export const HookNameBeforeSessionReset = 'before_session_reset';

export const AllHookNames: readonly HookNameValue[] = Object.values(HookName);

export type HookCategory = 'event' | 'interceptor';
export type HookMode = 'void' | 'modifying';

export interface HookDefinition {
  category: HookCategory;
  mode: HookMode;
  softTimeout?: boolean;
}

export const HookDefinitions: Record<HookNameValue, HookDefinition> = {
  [HookName.MessageReceived]: { category: 'event', mode: 'void' },
  [HookName.PrepareRunInput]: { category: 'interceptor', mode: 'modifying' },
  [HookName.PrepareModelResolve]: { category: 'interceptor', mode: 'modifying' },
  [HookName.PrepareAgentRun]: { category: 'interceptor', mode: 'modifying' },
  [HookName.PrepareAgentReply]: { category: 'interceptor', mode: 'modifying' },
  [HookName.RunStarted]: { category: 'event', mode: 'void' },
  [HookName.TurnStarted]: { category: 'event', mode: 'void' },
  [HookName.TurnCompleted]: { category: 'event', mode: 'void' },
  [HookName.PrepareToolCall]: { category: 'interceptor', mode: 'modifying' },
  [HookName.TransformToolResult]: { category: 'interceptor', mode: 'modifying' },
  [HookName.TransformToolEvent]: { category: 'interceptor', mode: 'modifying' },
  [HookName.TransformReasoningEvent]: { category: 'interceptor', mode: 'modifying' },
  [HookName.ToolCallCompleted]: { category: 'event', mode: 'void' },
  [HookName.PrepareAgentFinalize]: { category: 'interceptor', mode: 'modifying' },
  [HookName.RunCompleted]: { category: 'event', mode: 'void', softTimeout: true },
  [HookName.CompactionStarted]: { category: 'event', mode: 'void' },
  [HookName.CompactionCompleted]: { category: 'event', mode: 'void' },
  [HookName.PrepareSubagentSpawn]: { category: 'interceptor', mode: 'modifying' },
  [HookName.PrepareSubagentDelivery]: { category: 'interceptor', mode: 'modifying' },
  [HookName.SubagentSpawned]: { category: 'event', mode: 'void' },
  [HookName.SubagentEnded]: { category: 'event', mode: 'void', softTimeout: true }
};

export function isKnownHookName(name: string): name is HookNameValue {
  return name in HookDefinitions;
}

export const DefaultHookTimeoutMs = 30_000;
export const MaxHookTimeoutMs = 600_000;

export type HookEvent = Record<string, unknown>;

export interface ModifyingResult {
  block?: boolean;
  reason?: string;
  handled?: boolean;
  reply?: string;
  outcome?: string;
  prepend_context?: string;
  append_context?: string;
  replace_system_prompt?: string;
  model?: string;
  provider?: string;
  thinking_level?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  drop?: boolean;
  content?: string;
  data?: Record<string, unknown>;
  final_output?: string;
  [key: string]: unknown;
}
