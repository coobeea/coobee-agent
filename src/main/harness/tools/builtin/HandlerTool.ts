import type { ToolCategory } from '../../types/ToolTypes';
import type { StreamUpdate, ToolResult } from '../../types/ToolTypes';
import type { ExecContext, Tool, ToolDescriptor } from '../definition/Tool';

export type BuiltinHandler = (
  ctx: ExecContext,
  params: Record<string, unknown>,
  onUpdate?: (update: StreamUpdate) => void
) => Promise<ToolResult>;

/**
 * Wraps a descriptor + handler into a Tool implementation.
 */
export class HandlerTool implements Tool {
  constructor(
    private readonly desc: ToolDescriptor,
    private readonly handler: BuiltinHandler,
    private readonly schemaFn?: () => Record<string, unknown>
  ) {}

  descriptor(): ToolDescriptor {
    return this.desc;
  }

  parametersSchema(): Record<string, unknown> {
    return this.schemaFn?.() ?? { type: 'object', properties: {} };
  }

  async execute(
    ctx: ExecContext,
    params: Record<string, unknown>,
    onUpdate?: (update: StreamUpdate) => void
  ): Promise<ToolResult> {
    return this.handler(ctx, params, onUpdate);
  }
}

export function createHandlerTool(
  name: string,
  description: string,
  category: ToolCategory,
  handler: BuiltinHandler,
  opts?: {
    needUserConfirm?: boolean;
    audience?: ToolDescriptor['audience'];
    parametersSchema?: () => Record<string, unknown>;
  }
): HandlerTool {
  return new HandlerTool(
    {
      name,
      description,
      category,
      needUserConfirm: opts?.needUserConfirm,
      audience: opts?.audience
    },
    handler,
    opts?.parametersSchema
  );
}
