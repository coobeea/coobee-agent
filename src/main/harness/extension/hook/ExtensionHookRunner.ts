import { HookDefinitions, type HookEvent, type HookNameValue, type ModifyingResult } from './HookName';
import type { HookRunDeps, HookRunner, RegisteredHook } from './HookRunner';
import { NopHookRunDeps } from './NopHookRunDeps';

/**
 * 空 Hook 调度器：所有调用空操作。
 */
export class NoopHookRunner implements HookRunner {
  setRunDeps(deps: HookRunDeps | null): void {
    void deps;
  }

  async run(name: HookNameValue, event: HookEvent): Promise<undefined> {
    void name;
    void event;
    return undefined;
  }

  async runVoid(name: HookNameValue, event: HookEvent): Promise<void> {
    void name;
    void event;
  }

  async runSoftVoid(name: HookNameValue, event: HookEvent): Promise<void> {
    void name;
    void event;
  }

  async runModifying(name: HookNameValue, event: HookEvent): Promise<undefined> {
    void name;
    void event;
    return undefined;
  }

  isHookDisabled(extensionId: string): boolean {
    void extensionId;
    return false;
  }
}

/**
 * 内存 Hook 调度器：void 并行、modifying 按 priority 降序串行 merge。
 */
export class ExtensionHookRunner implements HookRunner {
  private readonly hooks = new Map<HookNameValue, RegisteredHook[]>();
  private readonly failed = new Set<string>();
  private deps: HookRunDeps = new NopHookRunDeps();

  setRunDeps(deps: HookRunDeps | null): void {
    this.deps = deps ?? new NopHookRunDeps();
  }

  register(hook: RegisteredHook): void {
    if (!(hook.name in HookDefinitions)) {
      throw new Error(`extension: unknown hook name: ${hook.name}`);
    }
    const list = this.hooks.get(hook.name) ?? [];
    list.push(hook);
    list.sort((a, b) => b.priority - a.priority);
    this.hooks.set(hook.name, list);
  }

  unregisterByExtension(extensionId: string): void {
    for (const [name, list] of this.hooks) {
      this.hooks.set(
        name,
        list.filter((h) => h.extensionId !== extensionId)
      );
    }
  }

  markFailed(extensionId: string): void {
    this.failed.add(extensionId);
  }

  isHookDisabled(extensionId: string): boolean {
    return this.failed.has(extensionId);
  }

  async run(name: HookNameValue, event: HookEvent): Promise<ModifyingResult | undefined> {
    const def = HookDefinitions[name];
    if (!def) return undefined;
    if (def.mode === 'modifying') {
      return this.runModifying(name, event);
    }
    await this.runVoid(name, event);
    return undefined;
  }

  async runVoid(name: HookNameValue, event: HookEvent): Promise<void> {
    const list = this.activeHooks(name);
    await Promise.all(
      list.map(async (h) => {
        try {
          await h.handler(this.deps, event);
        } catch {
          // void hooks soft-fail
        }
      })
    );
  }

  async runSoftVoid(name: HookNameValue, event: HookEvent): Promise<void> {
    const def = HookDefinitions[name];
    if (def?.softTimeout) {
      // SoftTimeout：不阻塞调用方；fire-and-forget
      void this.runVoid(name, event);
      return;
    }
    await this.runVoid(name, event);
  }

  async runModifying(name: HookNameValue, event: HookEvent): Promise<ModifyingResult | undefined> {
    const list = this.activeHooks(name);
    let merged: ModifyingResult = {};
    let currentEvent: HookEvent = { ...event };

    for (const h of list) {
      try {
        const result = (await h.handler(this.deps, currentEvent)) as ModifyingResult | undefined;
        if (!result || typeof result !== 'object') continue;
        merged = mergeModifying(name, merged, result);
        currentEvent = { ...currentEvent, ...result };
        if (result.block || result.handled || result.outcome === 'block') {
          break;
        }
      } catch {
        // modifying: skip failed handler
      }
    }

    return Object.keys(merged).length > 0 ? merged : undefined;
  }

  private activeHooks(name: HookNameValue): RegisteredHook[] {
    return (this.hooks.get(name) ?? []).filter((h) => !this.failed.has(h.extensionId));
  }
}

function mergeModifying(name: HookNameValue, base: ModifyingResult, next: ModifyingResult): ModifyingResult {
  const out: ModifyingResult = { ...base, ...next };
  // prepare_run_input：prepend/append 拼接而非覆盖
  if (name === 'prepare_run_input') {
    if (base.prepend_context || next.prepend_context) {
      out.prepend_context = `${base.prepend_context ?? ''}${next.prepend_context ?? ''}`;
    }
    if (base.append_context || next.append_context) {
      out.append_context = `${base.append_context ?? ''}${next.append_context ?? ''}`;
    }
  }
  return out;
}
