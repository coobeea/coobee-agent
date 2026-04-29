import { describe, expect, it } from 'vitest';
import type { CreateAgentSessionOptions, ToolDefinition as PiToolDefinition } from '@mariozechner/pi-coding-agent';
import { applyPiMonoCustomTools } from '../PiMonoAgentRuntime';

describe('applyPiMonoCustomTools', () => {
  it('将自定义工具同时注册为 customTools 和 active tools allowlist', () => {
    const sessionConfig: CreateAgentSessionOptions = {};
    const tools = [makeTool('read'), makeTool('write'), makeTool('write')];

    applyPiMonoCustomTools(sessionConfig, tools);

    expect(sessionConfig.customTools).toBe(tools);
    expect(sessionConfig.tools).toEqual(['read', 'write']);
  });

  it('没有自定义工具时不改写 sessionConfig', () => {
    const sessionConfig: CreateAgentSessionOptions = {};

    applyPiMonoCustomTools(sessionConfig, []);

    expect(sessionConfig.customTools).toBeUndefined();
    expect(sessionConfig.tools).toBeUndefined();
  });
});

function makeTool(name: string): PiToolDefinition {
  return {
    name,
    label: name,
    description: `${name} tool`,
    parameters: {
      type: 'object',
      properties: {}
    },
    execute: async () => ({
      content: [{ type: 'text', text: 'ok' }],
      details: {}
    })
  } as unknown as PiToolDefinition;
}
