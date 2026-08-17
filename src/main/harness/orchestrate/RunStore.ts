import type { HookRunDeps } from '../extension/hook/HookRunner';

/** 本轮 Run 上下文袋（替代 Go context value）。 */
export class RunStore {
  readonly store = new Map<string, unknown>();

  constructor(
    readonly runId: string,
    public hookDeps: HookRunDeps | null = null
  ) {}

  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  set(key: string, value: unknown): void {
    this.store.set(key, value);
  }
}
