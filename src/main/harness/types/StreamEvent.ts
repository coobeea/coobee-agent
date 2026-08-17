/**
 * Agent Mapper 产出的事件 type 闭集（路径 A：SDK → Mapper → 编排层）。
 */
export type MapperStreamEventType =
  | 'run:start'
  | 'turn:start'
  | 'llm:start'
  | 'text:start'
  | 'text:delta'
  | 'text:done'
  | 'reasoning:start'
  | 'reasoning:delta'
  | 'reasoning:done'
  | 'llm:done'
  | 'tool:start'
  | 'tool:delta'
  | 'tool:done'
  | 'turn:done'
  | 'run:done'
  | 'agent:notify'
  | 'compaction:start'
  | 'compaction:done'
  | 'subagent:spawn:start'
  | 'subagent:spawn:done'
  | 'subagent:spawn:error'
  | 'subagent:run:start'
  | 'subagent:run:done'
  | 'subagent:end'
  | 'stream:error';

export const MapperStreamEventTypes: readonly MapperStreamEventType[] = [
  'run:start',
  'turn:start',
  'llm:start',
  'text:start',
  'text:delta',
  'text:done',
  'reasoning:start',
  'reasoning:delta',
  'reasoning:done',
  'llm:done',
  'tool:start',
  'tool:delta',
  'tool:done',
  'turn:done',
  'run:done',
  'agent:notify',
  'compaction:start',
  'compaction:done',
  'subagent:spawn:start',
  'subagent:spawn:done',
  'subagent:spawn:error',
  'subagent:run:start',
  'subagent:run:done',
  'subagent:end'
] as const;

/** stream:error 仅内部信号，不写入 events.jsonl，故不在 MapperStreamEventTypes 列表。 */

export interface StreamEvent {
  type: MapperStreamEventType;
  content?: string;
  data?: Record<string, unknown>;
}

export function isMapperStreamEventType(type: string): type is MapperStreamEventType {
  return (MapperStreamEventTypes as readonly string[]).includes(type) || type === 'stream:error';
}
