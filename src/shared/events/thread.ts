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
  /** Agent 业务项目目录（= agents/{agentId}/project），也是工具默认 cwd */
  projectPath: string;
  /** Agent 业务项目目录（同 projectPath，显式字段便于前端消除歧义） */
  agentProjectPath: string;
  /** @deprecated Use projectPath/agentProjectPath. */
  workspacePath: string;
  /** @deprecated Use projectPath/agentProjectPath. */
  agentWorkspacePath: string;
  /** 当前 Thread 的会话产物目录（= agents/{agentId}/sessions/{threadId}） */
  sessionPath: string;
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
