import { mkdir, readFile, writeFile, appendFile, access } from 'node:fs/promises';
import path from 'node:path';
import type { Envelope } from '../event/spec/Envelope';
import { Envelope as EnvelopeClass } from '../event/spec/Envelope';
import { Meta } from '../event/spec/Meta';
import type { EventType } from '../event/spec/EventType';
import {
  DirSubagents,
  SessionFile,
  type ClearConversationResult,
  type ContextUsageInput,
  type PathContext,
  type ReadMessagesOptions,
  type SessionMetadata,
  type SessionStore,
  type SessionTodoList
} from './SessionStore';

/**
 * 基于文件系统的 SessionStore（JSONL + metadata.json）。
 */
export class FileSessionStore implements SessionStore {
  constructor(private readonly root: string) {
    if (!root.trim()) {
      throw new Error('session: SessionsRoot is required');
    }
  }

  sessionsRoot(): string {
    return this.root;
  }

  isSubagentStorage(ctx?: PathContext): boolean {
    return Boolean(ctx?.parentSessionId);
  }

  sessionDir(sessionId: string, ctx?: PathContext): string {
    if (ctx?.parentSessionId) {
      const childDir = ctx.scopedChildDir || DirSubagents;
      return path.join(this.root, ctx.parentSessionId, childDir, sessionId);
    }
    return path.join(this.root, sessionId);
  }

  async ensureSessionDirs(sessionId: string, ctx?: PathContext): Promise<void> {
    const dir = this.sessionDir(sessionId, ctx);
    await mkdir(dir, { recursive: true });
    if (!this.isSubagentStorage(ctx)) {
      await mkdir(path.join(dir, DirSubagents), { recursive: true });
    }
  }

  async readMetadata(sessionId: string, ctx?: PathContext): Promise<SessionMetadata | null> {
    const file = path.join(this.sessionDir(sessionId, ctx), SessionFile.Metadata);
    try {
      const raw = await readFile(file, 'utf8');
      return JSON.parse(raw) as SessionMetadata;
    } catch {
      return null;
    }
  }

  async writeMetadata(sessionId: string, patch: Record<string, unknown>, ctx?: PathContext): Promise<SessionMetadata> {
    await this.ensureSessionDirs(sessionId, ctx);
    const now = new Date().toISOString();
    const existing = (await this.readMetadata(sessionId, ctx)) ?? {};
    const next: SessionMetadata = {
      ...existing,
      ...patch,
      session_id: sessionId,
      updated_at: now,
      created_at: existing.created_at ?? now
    };
    const file = path.join(this.sessionDir(sessionId, ctx), SessionFile.Metadata);
    await writeFile(file, JSON.stringify(next, null, 2), 'utf8');
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
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...record };
    } else {
      list.push(record);
    }
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
    await this.ensureSessionDirs(sessionId, ctx);
    const file = path.join(this.sessionDir(sessionId, ctx), SessionFile.Events);
    await appendFile(file, `${JSON.stringify(envelope.toJSON())}\n`, 'utf8');
  }

  async appendUIMessageEvent(sessionId: string, envelope: Envelope, ctx?: PathContext): Promise<void> {
    await this.ensureSessionDirs(sessionId, ctx);
    const file = path.join(this.sessionDir(sessionId, ctx), SessionFile.Messages);
    await appendFile(file, `${JSON.stringify(envelope.toJSON())}\n`, 'utf8');
  }

  async readUIMessageEvents(sessionId: string, ctx?: PathContext): Promise<Envelope[]> {
    const file = path.join(this.sessionDir(sessionId, ctx), SessionFile.Messages);
    return this.readEnvelopeFile(file);
  }

  async readMessages(sessionId: string, opts?: ReadMessagesOptions): Promise<Record<string, unknown>[]> {
    const ctx: PathContext | undefined = opts?.parentSessionId ? { parentSessionId: opts.parentSessionId } : undefined;
    const file = path.join(this.sessionDir(sessionId, ctx), SessionFile.Messages);
    const lines = await this.readJsonl(file);
    const limit = opts?.limit && opts.limit > 0 ? opts.limit : lines.length;
    return lines.slice(-limit);
  }

  async readTodos(sessionId: string, ctx?: PathContext): Promise<SessionTodoList> {
    const file = path.join(this.sessionDir(sessionId, ctx), SessionFile.Todos);
    try {
      const raw = await readFile(file, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.todos) ? parsed.todos : [];
    } catch {
      return [];
    }
  }

  async writeTodos(sessionId: string, list: SessionTodoList, ctx?: PathContext): Promise<SessionTodoList> {
    await this.ensureSessionDirs(sessionId, ctx);
    const file = path.join(this.sessionDir(sessionId, ctx), SessionFile.Todos);
    await writeFile(file, JSON.stringify(list, null, 2), 'utf8');
    return list;
  }

  async clearTodos(sessionId: string, ctx?: PathContext): Promise<SessionTodoList> {
    return this.writeTodos(sessionId, [], ctx);
  }

  async clearConversation(sessionId: string, ctx?: PathContext): Promise<ClearConversationResult> {
    if (this.isSubagentStorage(ctx)) {
      throw new Error('session: clearConversation is forbidden on subagent storage');
    }
    await this.ensureSessionDirs(sessionId, ctx);
    const dir = this.sessionDir(sessionId, ctx);
    for (const name of [SessionFile.Messages, SessionFile.Events, SessionFile.Todos]) {
      await writeFile(path.join(dir, name), name.endsWith('.json') ? '[]\n' : '', 'utf8');
    }
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

  private async readJsonl(file: string): Promise<Record<string, unknown>[]> {
    try {
      await access(file);
    } catch {
      return [];
    }
    const raw = await readFile(file, 'utf8');
    return raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  }

  private async readEnvelopeFile(file: string): Promise<Envelope[]> {
    const rows = await this.readJsonl(file);
    return rows.map((row) => {
      const metaRaw = (row.meta ?? {}) as Record<string, unknown>;
      const meta = Meta.create({
        runtimeId: String(metaRaw.runtime_id ?? ''),
        agentId: String(metaRaw.agent_id ?? ''),
        userId: String(metaRaw.user_id ?? ''),
        requestId: String(metaRaw.request_id ?? ''),
        sessionId: String(metaRaw.storage_session_id ?? metaRaw.session_id ?? ''),
        runId: String(metaRaw.run_id ?? ''),
        scope: (metaRaw.scope as Meta['scope']) ?? ''
      });
      return new EnvelopeClass({
        ts: String(row.ts ?? ''),
        type: row.type as EventType,
        content: String(row.content ?? ''),
        data: (row.data as Record<string, unknown>) ?? {},
        meta,
        eventId: row.event_id ? String(row.event_id) : undefined
      });
    });
  }
}
