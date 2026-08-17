import { ExtensionHookRunner, NoopHookRunner } from './hook/ExtensionHookRunner';
import type { HookRunner } from './hook/HookRunner';

/**
 * Extension 子系统装配结果：Registry + HookRunner + Loader（Loader 后续补全）。
 */
export class ExtensionSubsystem {
  readonly hookRunner: HookRunner;

  private constructor(hookRunner: HookRunner) {
    this.hookRunner = hookRunner;
  }

  static create(options?: { noop?: boolean }): ExtensionSubsystem {
    if (options?.noop) {
      return new ExtensionSubsystem(new NoopHookRunner());
    }
    return new ExtensionSubsystem(new ExtensionHookRunner());
  }
}
