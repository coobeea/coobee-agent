import type { ToolResult } from '../types/ToolTypes';
import type { ExecContext, Tool } from './definition/Tool';
import type { ToolRegistry } from './ToolRegistry';
import { formatError } from './builtin/helpers';

/**
 * Bound call site: registry pipeline + fixed ExecContext per agent turn.
 */
export class Invoker {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly ctx: ExecContext
  ) {}

  /** Runs a tool by name through the shared pipeline. */
  async invoke(name: string, params: Record<string, unknown> = {}): Promise<ToolResult> {
    const tool = this.registry.get(name);
    if (!tool) {
      return formatError('TOOL_NOT_FOUND', `tool not found: ${name}`);
    }
    return this.registry.getPipeline().run(tool, this.ctx, params);
  }

  /** Runs a known tool instance through the shared pipeline. */
  async call(tool: Tool, params: Record<string, unknown> = {}): Promise<ToolResult> {
    return this.registry.getPipeline().run(tool, this.ctx, params);
  }
}

export function createInvoker(registry: ToolRegistry, ctx: ExecContext): Invoker {
  return new Invoker(registry, ctx);
}
