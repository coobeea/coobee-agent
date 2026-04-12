import type { ToolDefinition, ToolStreamUpdate, ToolResult, ToolExecutionContext } from '../types';
import { ToolCategory } from '../types';

export const processTool: ToolDefinition = {
  name: 'process',
  description: 'Manage background processes',
  category: ToolCategory.Execute,
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string' }
    },
    required: ['action']
  } as any,
  async *execute(_params: Record<string, unknown>, _signal?: AbortSignal, _context?: ToolExecutionContext): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    return { success: true, llmContent: 'Process tool is disabled in minimal mode.' };
  }
};
