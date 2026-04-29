/**
 * Thread 事件与轻量列表条目类型。
 */

export const ThreadEventTypes = {
  /** Thread 元信息变更 */
  MESSAGE: 'thread:message'
} as const;

export type ThreadEventType = (typeof ThreadEventTypes)[keyof typeof ThreadEventTypes];

export type ThreadRunStatus = 'idle' | 'running' | 'completed' | 'error';

export type ThreadStatus = 'active' | 'archived' | 'deleted';

export type ThreadRuntimeType = 'pi-mono' | 'openai' | 'claude';

/** Thread 索引条目（列表与事件共用的轻量形态） */
export interface ThreadEntry {
  id: string;
  title: string;
  agentId: string;
  agentName?: string;
  status: ThreadStatus;
  runStatus: ThreadRunStatus;
  createdAt: string;
  updatedAt: string;
  workspacePath: string;
  agentHomePath: string;
  overrideModel?: string | null;
  runtimeType?: ThreadRuntimeType;
  enableThinking?: boolean;
  asrEnabled?: boolean;
  ttsEnabled?: boolean;
}

export type ThreadMessageAction = 'created' | 'updated' | 'deleted';

export interface ThreadMessageEventPayload {
  type: typeof ThreadEventTypes.MESSAGE;
  action: ThreadMessageAction;
  threadId: string;
  thread?: ThreadEntry;
  prevRunStatus?: ThreadRunStatus;
  timestamp: number;
}
