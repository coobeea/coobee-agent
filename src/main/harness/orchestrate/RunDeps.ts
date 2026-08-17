import type { Emitter } from '../event/Emitter';
import type { HookRunner } from '../extension/hook/HookRunner';
import type { Logger } from '../logger/Logger';
import type { SessionStore } from '../session/SessionStore';
import type { PolicyDefaults } from '../types/PolicyDefaults';
import { defaultPolicyDefaults } from '../types/PolicyDefaults';

/** 整轮 Run 编排所需依赖。 */
export class RunDeps {
  constructor(
    readonly sessions: SessionStore,
    readonly emitter: Emitter,
    readonly hooks: HookRunner,
    readonly logger: Logger
  ) {}
}

/** 编排层单次 Run 入参。 */
export interface RunRequest {
  sessionId: string;
  runId: string;
  runtimeId: string;
  agentId: string;
  userId: string;
  requestId?: string;
  parentSessionId?: string;
  scopedChildDir?: string;
  message: string;
  model?: string;
  provider?: string;
  instructions?: string;
  systemAppend?: string;
  skipInputPolicy?: string;
  thinkingLevel?: string;
  temperature?: number;
  attachments?: Record<string, unknown>[];
  contextWindow?: number;
  queueItemId?: string;
  clientMessageId?: string;
  agentRoot?: string;
  workspaceRoot?: string;
  sessionRoot?: string;
  policyDefaults?: PolicyDefaults;
  deps: RunDeps;
}

export function withDefaultPolicy(req: RunRequest): PolicyDefaults {
  return req.policyDefaults ?? defaultPolicyDefaults();
}
