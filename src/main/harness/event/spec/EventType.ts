/** 标准事件 type（namespace:action 闭集）。 */
export type EventType =
  | 'runtime:status'
  | 'runtime:error'
  | 'user:input'
  | 'run:start'
  | 'run:error'
  | 'run:done'
  | 'turn:start'
  | 'turn:done'
  | 'llm:start'
  | 'llm:done'
  | 'text:start'
  | 'text:delta'
  | 'text:done'
  | 'reasoning:start'
  | 'reasoning:delta'
  | 'reasoning:done'
  | 'tool:start'
  | 'tool:delta'
  | 'tool:done'
  | 'agent:notify'
  | 'agent:start'
  | 'agent:done'
  | 'compaction:start'
  | 'compaction:delta'
  | 'compaction:done'
  | 'subagent:spawn:start'
  | 'subagent:spawn:done'
  | 'subagent:spawn:error'
  | 'subagent:run:start'
  | 'subagent:run:done'
  | 'subagent:end';

export const EventTypeCatalog = {
  RuntimeStatus: 'runtime:status',
  RuntimeError: 'runtime:error',
  UserInput: 'user:input',
  RunStart: 'run:start',
  RunError: 'run:error',
  RunDone: 'run:done',
  TurnStart: 'turn:start',
  TurnDone: 'turn:done',
  LLMStart: 'llm:start',
  LLMDone: 'llm:done',
  TextStart: 'text:start',
  TextDelta: 'text:delta',
  TextDone: 'text:done',
  ReasoningStart: 'reasoning:start',
  ReasoningDelta: 'reasoning:delta',
  ReasoningDone: 'reasoning:done',
  ToolStart: 'tool:start',
  ToolDelta: 'tool:delta',
  ToolDone: 'tool:done',
  AgentNotify: 'agent:notify',
  AgentStart: 'agent:start',
  AgentDone: 'agent:done',
  CompactionStart: 'compaction:start',
  CompactionDelta: 'compaction:delta',
  CompactionDone: 'compaction:done',
  SubagentSpawnStart: 'subagent:spawn:start',
  SubagentSpawnDone: 'subagent:spawn:done',
  SubagentSpawnError: 'subagent:spawn:error',
  SubagentRunStart: 'subagent:run:start',
  SubagentRunDone: 'subagent:run:done',
  SubagentEnd: 'subagent:end'
} as const satisfies Record<string, EventType>;

export const AllEventTypes: readonly EventType[] = Object.values(EventTypeCatalog);

const knownTypes = new Set<string>(AllEventTypes);

export function isKnownEventType(typ: string): boolean {
  return knownTypes.has(typ);
}

export const ReservedEventTypes = ['session:reset', 'session:idle'] as const;

export function isReservedEventType(typ: string): boolean {
  return (ReservedEventTypes as readonly string[]).includes(typ);
}
