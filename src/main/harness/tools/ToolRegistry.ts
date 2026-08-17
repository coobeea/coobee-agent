import type { Scope } from '../types/Scope';
import type { Logger } from '../logger/Logger';
import { orNop } from '../logger/Logger';
import type { HookRunner } from '../extension/hook/HookRunner';
import type { ExecContext, RegisteredToolEntry, Tool, ToolDescriptor } from './definition/Tool';
import { visibleForAgent } from './definition/Tool';
import { Invoker } from './Invoker';
import { ToolPipeline } from './ToolPipeline';

/**
 * 进程内全局工具注册表。
 */
export class ToolRegistry {
  private readonly entries = new Map<string, RegisteredToolEntry>();
  private logger: Logger = orNop(null);
  private hooks: HookRunner | null = null;
  private readonly pipeline = new ToolPipeline(() => this.hooks);

  setLogger(logger: Logger): void {
    this.logger = orNop(logger);
  }

  setHooks(hooks: HookRunner | null): void {
    this.hooks = hooks;
  }

  getPipeline(): ToolPipeline {
    return this.pipeline;
  }

  async register(entry: RegisteredToolEntry): Promise<void> {
    const name = entry.tool.descriptor().name;
    if (!name) {
      throw new Error('tools: tool name is required');
    }
    const replaced = this.entries.has(name);
    this.entries.set(name, entry);
    this.logger.debug(
      `[tools] ${replaced ? 'replaced' : 'registered'} ${name} ext=${entry.extensionId || '(harness)'}`
    );
  }

  invoker(ctx: ExecContext): Invoker {
    return new Invoker(this, ctx);
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  unregisterByExtension(extensionId: string): void {
    for (const [name, entry] of this.entries) {
      if (entry.extensionId === extensionId) {
        this.entries.delete(name);
      }
    }
  }

  get(name: string): Tool | undefined {
    return this.entries.get(name)?.tool;
  }

  entriesList(): RegisteredToolEntry[] {
    return [...this.entries.values()];
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  filterForAgent(scope: Scope): ToolDescriptor[] {
    return this.entriesList()
      .map((e) => e.tool.descriptor())
      .filter((d) => visibleForAgent(d, scope));
  }

  entriesForAgent(scope: Scope): RegisteredToolEntry[] {
    return this.entriesList().filter((e) => visibleForAgent(e.tool.descriptor(), scope));
  }
}
