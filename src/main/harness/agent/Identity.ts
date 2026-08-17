import type { Scope } from '../types/Scope';
import type { Meta } from '../event/spec/Meta';
import { Meta as MetaClass } from '../event/spec/Meta';

/** Agent 实例创建时固化的只读属性。 */
export class Identity {
  readonly scope: Scope;
  readonly runtimeId: string;
  readonly agentId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly parentSessionId: string;
  readonly scopedChildDir: string;
  readonly agentRoot: string;
  readonly workspaceRoot: string;
  readonly sessionRoot: string;
  readonly sharedSkillsRoot: string;

  constructor(init: {
    scope?: Scope;
    runtimeId?: string;
    agentId?: string;
    userId?: string;
    sessionId?: string;
    parentSessionId?: string;
    scopedChildDir?: string;
    agentRoot: string;
    workspaceRoot?: string;
    sessionRoot: string;
    sharedSkillsRoot?: string;
  }) {
    if (!init.sessionRoot.trim()) {
      throw new Error('agent: SessionRoot is required (non-empty instance session dir)');
    }
    if (!init.agentRoot.trim()) {
      throw new Error('agent: AgentRoot is required');
    }
    this.scope = init.scope ?? '';
    this.runtimeId = init.runtimeId ?? '';
    this.agentId = init.agentId ?? '';
    this.userId = init.userId ?? '';
    this.sessionId = init.sessionId ?? '';
    this.parentSessionId = init.parentSessionId ?? '';
    this.scopedChildDir = init.scopedChildDir ?? '';
    this.agentRoot = init.agentRoot.trim();
    this.workspaceRoot = init.workspaceRoot ?? '';
    this.sessionRoot = init.sessionRoot.trim();
    this.sharedSkillsRoot = init.sharedSkillsRoot ?? '';
  }

  eventMeta(): Meta {
    return MetaClass.create({
      runtimeId: this.runtimeId,
      agentId: this.agentId,
      userId: this.userId,
      sessionId: this.sessionId,
      scope: this.scope
    }).withChildSession(this.parentSessionId, this.scopedChildDir);
  }
}
