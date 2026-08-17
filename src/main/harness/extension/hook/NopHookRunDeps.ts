import type { PolicyDefaults } from '../../types/PolicyDefaults';
import { defaultPolicyDefaults } from '../../types/PolicyDefaults';
import type { HookIdentity, HookRunDeps, ModelBinding, SessionReader } from './HookRunner';

class EmptySessionReader implements SessionReader {
  async readRecentDialogue(): Promise<[]> {
    return [];
  }
}

export class NopHookRunDeps implements HookRunDeps {
  private binding: ModelBinding = { model: '', provider: '' };

  constructor(
    private readonly id: HookIdentity = {
      scope: '',
      runtimeId: '',
      agentId: '',
      userId: '',
      sessionId: '',
      agentRoot: '',
      workspaceRoot: '',
      sessionRoot: ''
    },
    private readonly policy: PolicyDefaults = defaultPolicyDefaults()
  ) {}

  identity(): HookIdentity {
    return this.id;
  }

  policyDefaults(): PolicyDefaults {
    return this.policy;
  }

  session(): SessionReader {
    return new EmptySessionReader();
  }

  async emit(): Promise<void> {
    /* noop */
  }

  resolvedModelBinding(): ModelBinding {
    return this.binding;
  }

  setResolvedModelBinding(binding: ModelBinding): void {
    this.binding = {
      model: binding.model || this.binding.model,
      provider: binding.provider || this.binding.provider
    };
  }
}
