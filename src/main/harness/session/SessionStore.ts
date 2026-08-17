import type { Envelope } from '../event/spec/Envelope';

export const SessionFile = {
  Messages: 'messages.jsonl',
  Events: 'events.jsonl',
  Metadata: 'metadata.json',
  Session: 'session.jsonl',
  Queue: 'queue.jsonl',
  Todos: 'todos.json',
  Subagents: 'subagents'
} as const;

export const DirSubagents = 'subagents';

/** 子会话路径上下文。 */
export interface PathContext {
  parentSessionId?: string;
  scopedChildDir?: string;
}

export interface SessionMetadata {
  session_id?: string;
  created_at?: string;
  updated_at?: string;
  status?: string;
  run_status?: string;
  [key: string]: unknown;
}

export interface ContextUsageInput {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  contextWindow?: number;
}

export interface SessionTodoItem {
  id: string;
  content: string;
  status: string;
  [key: string]: unknown;
}

export type SessionTodoList = SessionTodoItem[];

export interface ClearConversationResult {
  session_id: string;
  cleared: boolean;
}

export interface ReadMessagesOptions {
  limit?: number;
  parentSessionId?: string;
}

export interface PathResolver {
  sessionsRoot(): string;
  sessionDir(sessionId: string, ctx?: PathContext): string;
  isSubagentStorage(ctx?: PathContext): boolean;
}

/**
 * 会话标准文件持久化契约。
 */
export interface SessionStore extends PathResolver {
  ensureSessionDirs(sessionId: string, ctx?: PathContext): Promise<void>;
  readMetadata(sessionId: string, ctx?: PathContext): Promise<SessionMetadata | null>;
  writeMetadata(sessionId: string, patch: Record<string, unknown>, ctx?: PathContext): Promise<SessionMetadata>;
  upsertSubagentRecord(
    parentSessionId: string,
    childSessionId: string,
    patch: Record<string, unknown>
  ): Promise<SessionMetadata>;
  writeContextUsage(sessionId: string, usage: ContextUsageInput, ctx?: PathContext): Promise<SessionMetadata>;
  appendEvent(sessionId: string, envelope: Envelope, ctx?: PathContext): Promise<void>;
  appendUIMessageEvent(sessionId: string, envelope: Envelope, ctx?: PathContext): Promise<void>;
  readUIMessageEvents(sessionId: string, ctx?: PathContext): Promise<Envelope[]>;
  readMessages(sessionId: string, opts?: ReadMessagesOptions): Promise<Record<string, unknown>[]>;
  readTodos(sessionId: string, ctx?: PathContext): Promise<SessionTodoList>;
  writeTodos(sessionId: string, list: SessionTodoList, ctx?: PathContext): Promise<SessionTodoList>;
  clearTodos(sessionId: string, ctx?: PathContext): Promise<SessionTodoList>;
  clearConversation(sessionId: string, ctx?: PathContext): Promise<ClearConversationResult>;
}
