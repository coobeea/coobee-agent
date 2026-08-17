import type { Scope } from '../../types/Scope';
import type { PolicyDefaults } from '../../types/PolicyDefaults';
import type { HookEvent, HookNameValue, ModifyingResult } from './HookName';

export interface HookIdentity {
  scope: Scope;
  runtimeId: string;
  agentId: string;
  userId: string;
  sessionId: string;
  parentSessionId?: string;
  scopedChildDir?: string;
  agentRoot: string;
  workspaceRoot: string;
  sessionRoot: string;
  sharedSkillsRoot?: string;
}

export interface ModelBinding {
  model: string;
  provider: string;
}

export interface DialogueTurn {
  user: string;
  assistant: string;
}

export interface SessionReader {
  readRecentDialogue(opts?: {
    rounds?: number;
    excludeCurrentUser?: string;
    userMaxChars?: number;
    assistantMaxChars?: number;
  }): Promise<DialogueTurn[]>;
}

/** 当前 Run 提供给 Hook 的运行时依赖。 */
export interface HookRunDeps {
  identity(): HookIdentity;
  policyDefaults(): PolicyDefaults;
  session(): SessionReader;
  emit(eventType: string, content: string, data?: unknown): Promise<void>;
  resolvedModelBinding(): ModelBinding;
  setResolvedModelBinding(binding: ModelBinding): void;
}

export type HookHandler = (deps: HookRunDeps, event: HookEvent) => Promise<unknown> | unknown;

export interface RegisteredHook {
  extensionId: string;
  name: HookNameValue;
  handler: HookHandler;
  priority: number;
  timeoutMs?: number;
}

export interface HookRunner {
  run(name: HookNameValue, event: HookEvent): Promise<ModifyingResult | undefined>;
  runVoid(name: HookNameValue, event: HookEvent): Promise<void>;
  runSoftVoid(name: HookNameValue, event: HookEvent): Promise<void>;
  runModifying(name: HookNameValue, event: HookEvent): Promise<ModifyingResult | undefined>;
  isHookDisabled(extensionId: string): boolean;
  setRunDeps(deps: HookRunDeps | null): void;
}
