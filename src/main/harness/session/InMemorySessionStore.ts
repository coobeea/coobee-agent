import type { Envelope } from '../event/spec/Envelope';
import {
  type ClearConversationResult,
  type ContextUsageInput,
  type PathContext,
  type ReadMessagesOptions,
  type SessionMetadata,
  type SessionStore,
  type SessionTodoList
} from './SessionStore';

/**
 * 内存 SessionStore，供单测与最小内核打通。
 */
export class InMemorySessionStore implements SessionStore {
  private readonly metas = new Map<string, SessionMetadata>();
  private readonly events = new Map<string, Envelope[]>();
  private readonly messages = new Map<string, Envelope[]>();
  private readonly todos = new Map<string, SessionTodoList>();

  constructor(private readonly root = '/memory/session') {}

  sessionsRoot(): string {
    return this.root;
  }

  isSubagentStorage(ctx?: PathContext): boolean {
    return Boolean(ctx?.parentSessionId);
  }

  sessionDir(sessionId: string, ctx?: PathContext): string {
    if (ctx?.parentSessionId) {
      return `${this.root}/${ctx.parentSessionId}/subagents/${sessionId}`;
    }
    return `${this.root}/${sessionId}`;
  }

  private key(sessionId: string, ctx?: PathContext): string {
    return this.sessionDir(sessionId, ctx);
  }

  async ensureSessionDirs(_sessionId: string, _ctx?: PathContext): Promise<void> {
    /* in-memory: nothing to create */
  }

  async readMetadata(sessionId: string, ctx?: PathContext): Promise<SessionMetadata | null> {
    return this.metas.get(this.key(sessionId, ctx)) ?? null;
  }

  async writeMetadata(sessionId: string, patch: Record<string, unknown>, ctx?: PathContext): Promise<SessionMetadata> {
    const k = this.key(sessionId, ctx);
    const now = new Date().toISOString();
    const existing = this.metas.get(k) ?? {};
    const next: SessionMetadata = {
      ...existing,
      ...patch,
      session_id: sessionId,
      updated_at: now,
      created_at: existing.created_at ?? now
    };
    this.metas.set(k, next);
    return next;
  }

  async upsertSubagentRecord(
    parentSessionId: string,
    childSessionId: string,
    patch: Record<string, unknown>
  ): Promise<SessionMetadata> {
    const meta = (await this.readMetadata(parentSessionId)) ?? { session_id: parentSessionId };
    const list = Array.isArray(meta.subagents) ? [...(meta.subagents as Record<string, unknown>[])] : [];
    const idx = list.findIndex((s) => s.session_id === childSessionId || s.id === childSessionId);
    const record = { session_id: childSessionId, ...patch };
    if (idx >= 0) list[idx] = { ...list[idx], ...record };
    else list.push(record);
    return this.writeMetadata(parentSessionId, { subagents: list });
  }

  async writeContextUsage(sessionId: string, usage: ContextUsageInput, ctx?: PathContext): Promise<SessionMetadata> {
    return this.writeMetadata(
      sessionId,
      {
        context_usage: {
          input_tokens: usage.inputTokens ?? 0,
          output_tokens: usage.outputTokens ?? 0,
          total_tokens: usage.totalTokens ?? 0,
          context_window: usage.contextWindow ?? 0
        }
      },
      ctx
    );
  }

  async appendEvent(sessionId: string, envelope: Envelope, ctx?: PathContext): Promise<void> {
    const k = this.key(sessionId, ctx);
    const list = this.events.get(k) ?? [];
    list.push(envelope);
    this.events.set(k, list);
  }

  async appendUIMessageEvent(sessionId: string, envelope: Envelope, ctx?: PathContext): Promise<void> {
    const k = this.key(sessionId, ctx);
    const list = this.messages.get(k) ?? [];
    list.push(envelope);
    this.messages.set(k, list);
  }

  async readUIMessageEvents(sessionId: string, ctx?: PathContext): Promise<Envelope[]> {
    return [...(this.messages.get(this.key(sessionId, ctx)) ?? [])];
  }

  async readMessages(sessionId: string, opts?: ReadMessagesOptions): Promise<Record<string, unknown>[]> {
    const ctx: PathContext | undefined = opts?.parentSessionId ? { parentSessionId: opts.parentSessionId } : undefined;
    const list = await this.readUIMessageEvents(sessionId, ctx);
    const rows = list.map((e) => e.toJSON());
    const limit = opts?.limit && opts.limit > 0 ? opts.limit : rows.length;
    return rows.slice(-limit);
  }

  async readTodos(sessionId: string, ctx?: PathContext): Promise<SessionTodoList> {
    return [...(this.todos.get(this.key(sessionId, ctx)) ?? [])];
  }

  async writeTodos(sessionId: string, list: SessionTodoList, ctx?: PathContext): Promise<SessionTodoList> {
    this.todos.set(this.key(sessionId, ctx), [...list]);
    return [...list];
  }

  async clearTodos(sessionId: string, ctx?: PathContext): Promise<SessionTodoList> {
    return this.writeTodos(sessionId, [], ctx);
  }

  async clearConversation(sessionId: string, ctx?: PathContext): Promise<ClearConversationResult> {
    if (this.isSubagentStorage(ctx)) {
      throw new Error('session: clearConversation is forbidden on subagent storage');
    }
    const k = this.key(sessionId, ctx);
    this.events.set(k, []);
    this.messages.set(k, []);
    this.todos.set(k, []);
    await this.writeMetadata(
      sessionId,
      {
        status: 'active',
        run_status: 'completed',
        last_message_at: undefined,
        context_usage: undefined
      },
      ctx
    );
    return { session_id: sessionId, cleared: true };
  }
}
