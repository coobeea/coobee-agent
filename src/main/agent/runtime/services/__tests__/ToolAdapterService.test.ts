import { describe, it, expect, vi } from 'vitest';
import { ToolAdapterService } from '../ToolAdapterService';
import { z } from 'zod';
import type { ToolDefinition } from '../../types';
import type { ToolExecutionContext } from '../../../tools/types';

const sandboxContext: ToolExecutionContext = {
  mode: 'path-only',
  workspaceRoot: '/tmp/workspace',
  toolPolicy: { allow: [], deny: [], confirm: [] },
  sessionId: 'test-session',
  threadId: 'test-session',
  cwd: '/tmp/workspace',
  sessionsDir: '/tmp/workspace/sessions',
  contextsDir: '/tmp/workspace/contexts',
  eventsDir: '/tmp/workspace/events',
  userHome: '/tmp/coobee-home',
  configDir: '/tmp/coobee-home/config',
  tempDir: '/tmp',
  agentName: 'agent',
  agentMode: 'agent'
};

describe('ToolAdapterService', () => {
  it('应该转换工具定义为 SDK Tools', () => {
    const service = new ToolAdapterService(sandboxContext);

    const toolDefs: ToolDefinition[] = [
      {
        name: 'test_tool',
        description: 'A test tool',
        category: 'utility' as never,
        parameters: z.object({
          param: z.string()
        }),
        execute: vi.fn()
      }
    ];

    const sdkTools = service.convertTools(toolDefs);

    expect(sdkTools).toHaveLength(1);
    expect(sdkTools[0]).toHaveProperty('name', 'test_tool');
    expect(sdkTools[0]).toHaveProperty('description', 'A test tool');
  });

  it('应该合并 SDK Tools 和 ToolDefinition', () => {
    const service = new ToolAdapterService(sandboxContext);

    const sdkTools = [] as never[]; // Mock SDK tools
    const toolDefs: ToolDefinition[] = [
      {
        name: 'tool1',
        description: 'Tool 1',
        category: 'utility' as never,
        parameters: z.object({}),
        execute: vi.fn()
      },
      {
        name: 'tool2',
        description: 'Tool 2',
        category: 'utility' as never,
        parameters: z.object({}),
        execute: vi.fn()
      }
    ];

    const merged = service.mergeTools(sdkTools, toolDefs);

    expect(merged).toHaveLength(2);
  });
});
