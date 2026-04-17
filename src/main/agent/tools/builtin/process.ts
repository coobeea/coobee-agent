import { z } from 'zod';
import type { ToolDefinition, ToolStreamUpdate, ToolResult, ToolExecutionContext } from '../types';
import { ToolCategory } from '../types';

export const processTool: ToolDefinition = {
  name: 'process',
  description: 'Manage background processes',
  category: ToolCategory.Execute,
  needUserConfirm: false,
  parameters: z.object({
    action: z.string().describe('Action to perform: list, read, write, kill')
  }),
  async *execute(_params: Record<string, unknown>, _signal?: AbortSignal, _context?: ToolExecutionContext): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    return { success: true, llmContent: 'Process tool is disabled in minimal mode.' };
  }
};
