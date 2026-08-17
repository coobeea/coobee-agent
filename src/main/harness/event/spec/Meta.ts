import type { Scope } from '../../types/Scope';

/**
 * 事件 meta 通用层契约。
 * 结构体只放跨模式通用字段；模式/业务扩展写入 Extra。
 */
export class Meta {
  runtimeId = '';
  agentId = '';
  userId = '';
  requestId = '';
  sessionId = '';
  runId = '';
  scope: Scope = '';
  extra: Record<string, unknown> | undefined;

  static create(partial: Partial<MetaFields> = {}): Meta {
    const m = new Meta();
    Object.assign(m, partial);
    return m;
  }

  clone(): Meta {
    const m = new Meta();
    m.runtimeId = this.runtimeId;
    m.agentId = this.agentId;
    m.userId = this.userId;
    m.requestId = this.requestId;
    m.sessionId = this.sessionId;
    m.runId = this.runId;
    m.scope = this.scope;
    m.extra = this.extra ? { ...this.extra } : undefined;
    return m;
  }

  broadcastSessionId(): string {
    const fromExtra = this.extraString('broadcast_session_id');
    if (fromExtra) return fromExtra;
    const parent = this.extraString('parent_session_id');
    if (parent) return parent;
    return this.sessionId;
  }

  storageSessionId(): string {
    const fromExtra = this.extraString('storage_session_id');
    return fromExtra || this.sessionId;
  }

  validate(): void {
    if (!this.runtimeId.trim()) {
      throw new Error('event meta: runtime_id is required');
    }
    if (!this.agentId.trim()) {
      throw new Error('event meta: agent_id is required');
    }
    if (!this.broadcastSessionId().trim()) {
      throw new Error('event meta: broadcast_session_id is required');
    }
    if (!this.storageSessionId().trim()) {
      throw new Error('event meta: storage_session_id is required');
    }
  }

  withChildSession(parentSessionId: string, scopedChildDir: string): Meta {
    if (!parentSessionId) {
      return this;
    }
    const m = this.clone();
    m.extra = { ...(m.extra ?? {}) };
    m.extra.parent_session_id = parentSessionId;
    m.extra.broadcast_session_id = parentSessionId;
    m.extra.storage_session_id = this.sessionId;
    if (scopedChildDir) {
      m.extra.scoped_child_dir = scopedChildDir;
    }
    return m;
  }

  /** 合并 per-turn enrich；不覆盖 base 已有非空 Extra 键。 */
  mergeEnrich(enrich: Meta): Meta {
    const m = this.clone();
    if (enrich.scope && !m.scope) {
      m.scope = enrich.scope;
    }
    if (!enrich.extra || Object.keys(enrich.extra).length === 0) {
      return m;
    }
    m.extra = { ...(m.extra ?? {}) };
    for (const [k, v] of Object.entries(enrich.extra)) {
      if (v == null) continue;
      const existing = m.extra[k];
      if (existing != null && existing !== '') {
        if (typeof existing === 'string' && existing.trim() !== '') {
          continue;
        }
      }
      m.extra[k] = v;
    }
    return m;
  }

  isZero(): boolean {
    return !this.scope && (!this.extra || Object.keys(this.extra).length === 0);
  }

  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (this.runtimeId) out.runtime_id = this.runtimeId;
    if (this.agentId) out.agent_id = this.agentId;
    if (this.userId) out.user_id = this.userId;
    if (this.requestId) out.request_id = this.requestId;
    if (this.runId) out.run_id = this.runId;
    if (this.scope) out.scope = this.scope;
    const storage = this.storageSessionId();
    if (storage) out.storage_session_id = storage;
    const broadcast = this.broadcastSessionId();
    if (broadcast) out.broadcast_session_id = broadcast;
    if (this.extra) {
      for (const [k, v] of Object.entries(this.extra)) {
        if (v != null) out[k] = v;
      }
    }
    return out;
  }

  private extraString(key: string): string {
    if (!this.extra) return '';
    const v = this.extra[key];
    return typeof v === 'string' ? v.trim() : '';
  }
}

export interface MetaFields {
  runtimeId: string;
  agentId: string;
  userId: string;
  requestId: string;
  sessionId: string;
  runId: string;
  scope: Scope;
  extra: Record<string, unknown>;
}
