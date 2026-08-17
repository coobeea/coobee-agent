import type { Scope } from '../types/Scope';
import type { PolicyDefaults } from '../types/PolicyDefaults';
import { Meta } from '../event/spec/Meta';
import type { AgentOptions } from '../agent/AgentOptions';

let runCounter = 0;

/** Harness.newRunner 的本轮装配入参。 */
export class RunnerConfig {
  scope: Scope = '';
  agentRoot = '';
  workspaceRoot = '';
  sessionRoot = '';
  agentId = '';
  meta = Meta.create();

  sessionId = '';
  runId = '';
  runtimeId = '';
  userId = '';
  requestId = '';
  parentSessionId = '';
  scopedChildDir = '';

  message = '';
  model = '';
  provider = '';
  instructions = '';
  systemAppend = '';
  skipInputPolicy = '';
  thinkingLevel = '';
  temperature?: number;
  attachments?: Record<string, unknown>[];
  contextWindow = 0;
  queueItemId = '';
  clientMessageId = '';
  policyDefaults?: PolicyDefaults;

  static create(partial: Partial<RunnerConfigFields> = {}): RunnerConfig {
    const cfg = new RunnerConfig();
    Object.assign(cfg, partial);
    if (partial.meta) {
      cfg.meta = partial.meta instanceof Meta ? partial.meta : Meta.create(partial.meta as never);
    }
    return cfg;
  }

  agentOverride(): Partial<AgentOptions> {
    const opts: Partial<AgentOptions> = {
      scope: this.scope,
      agentRoot: this.agentRoot || undefined,
      workspaceRoot: this.workspaceRoot || undefined,
      sessionRoot: this.sessionRoot || undefined,
      agentId: this.agentId || undefined,
      runtimeId: this.runtimeId || undefined,
      sessionId: this.sessionId || undefined,
      userId: this.userId || undefined,
      parentSessionId: this.parentSessionId || undefined,
      scopedChildDir: this.scopedChildDir || undefined
    };
    if (this.model) opts.defaultModel = this.model;
    if (this.provider) opts.defaultProvider = this.provider;
    if (this.contextWindow) opts.compactionContextWindow = this.contextWindow;
    if (this.policyDefaults) opts.policyDefaults = this.policyDefaults;
    return opts;
  }

  ensureRunId(): void {
    if (!this.runId) {
      runCounter += 1;
      this.runId = String(runCounter);
    }
  }

  emitterMeta(): Meta {
    const m = this.meta.clone();
    if (!m.scope && this.scope) {
      m.scope = this.scope;
    }
    return m;
  }

  identityMeta(): Meta {
    return Meta.create({
      runtimeId: this.runtimeId,
      agentId: this.agentId,
      userId: this.userId,
      requestId: this.requestId,
      sessionId: this.sessionId,
      runId: this.runId,
      scope: this.scope
    }).withChildSession(this.parentSessionId, this.scopedChildDir);
  }

  emitterFullMeta(): Meta {
    return this.identityMeta().mergeEnrich(this.emitterMeta());
  }
}

export interface RunnerConfigFields {
  scope: Scope;
  agentRoot: string;
  workspaceRoot: string;
  sessionRoot: string;
  agentId: string;
  meta: Meta;
  sessionId: string;
  runId: string;
  runtimeId: string;
  userId: string;
  requestId: string;
  parentSessionId: string;
  scopedChildDir: string;
  message: string;
  model: string;
  provider: string;
  instructions: string;
  systemAppend: string;
  skipInputPolicy: string;
  thinkingLevel: string;
  temperature: number;
  attachments: Record<string, unknown>[];
  contextWindow: number;
  queueItemId: string;
  clientMessageId: string;
  policyDefaults: PolicyDefaults;
}
