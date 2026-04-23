import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PromptAssemblyService } from '../PromptAssemblyService';

describe('PromptAssemblyService', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-assembly-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('按固定顺序组装 prompt blocks 并返回 appendInstructions', () => {
    const service = new PromptAssemblyService();
    const blocks = service.assemble({
      runtimePathsBlock: '<runtime_paths />',
      skillDiscoveryHint: '<skill_discovery />',
      extensionInstructions: ['ext-1', 'ext-2']
    });

    expect(blocks.map((block) => block.id)).toEqual([
      'runtime_paths',
      'skill_discovery',
      'extension_instruction_1',
      'extension_instruction_2'
    ]);
    expect(service.toInstructions(blocks)).toEqual(['<runtime_paths />', '<skill_discovery />', 'ext-1', 'ext-2']);
  });

  it('合并全局和 Agent 级 AGENTS.md，并跳过模板-only Agent 规则', () => {
    const globalAgents = path.join(tempDir, 'AGENTS.md');
    const agentHome = path.join(tempDir, 'agent-home');
    fs.mkdirSync(agentHome, { recursive: true });
    fs.writeFileSync(globalAgents, 'global rule', 'utf-8');
    fs.writeFileSync(path.join(agentHome, 'AGENTS.md'), '# Agent Rules\n\n<!-- template -->', 'utf-8');

    const service = new PromptAssemblyService();
    const blocks = service.assemble({
      globalAgentsMdPath: globalAgents,
      agentHome
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toContain('global rule');
    expect(blocks[0].content).not.toContain('template');
  });

  it('读取 workspace 根目录下的 Markdown 上下文文件并应用大小限制', () => {
    fs.writeFileSync(path.join(tempDir, 'a.md'), 'A'.repeat(200), 'utf-8');
    fs.writeFileSync(path.join(tempDir, 'b.txt'), 'ignore', 'utf-8');

    const service = new PromptAssemblyService();
    const blocks = service.assemble({
      workspace: tempDir,
      limits: {
        workspaceTotalChars: 500,
        workspaceFileChars: 40
      }
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe('workspace_context');
    expect(blocks[0].content).toContain('### a.md');
    expect(blocks[0].content).toContain('... (truncated)');
    expect(blocks[0].content).not.toContain('b.txt');
  });

  it('通过 AgentHomeManager 读取 Agent Home 注入内容', () => {
    const service = new PromptAssemblyService();
    const blocks = service.assemble({
      agentId: 'agent-1',
      agentHomeManager: {
        readInjectableFiles: (agentId: string) => `<agent_home>${agentId}</agent_home>`
      } as never
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe('agent_home');
    expect(blocks[0].estimatedTokens).toBeGreaterThan(0);
  });
});
