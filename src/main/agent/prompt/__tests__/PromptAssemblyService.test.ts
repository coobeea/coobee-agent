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
    const agentHome = path.join(tempDir, 'agent-home');
    fs.mkdirSync(agentHome, { recursive: true });
    fs.writeFileSync(path.join(agentHome, 'AGENTS.md'), 'agent rule', 'utf-8');

    const service = new PromptAssemblyService();
    const blocks = service.assemble({
      runtimePathsBlock: '<runtime_paths />',
      agentHome,
      skillDiscoveryHint: '<skill_discovery />',
      extensionInstructions: ['ext-1', 'ext-2']
    });

    expect(blocks.map((block) => block.id)).toEqual([
      'runtime_paths',
      'agent_rules',
      'skill_discovery',
      'extension_instruction_1',
      'extension_instruction_2'
    ]);
    expect(service.toInstructions(blocks)).toEqual([
      '<runtime_paths />',
      `<agent_rules path="${path.join(agentHome, 'AGENTS.md')}">\nagent rule\n</agent_rules>`,
      '<skill_discovery />',
      'ext-1',
      'ext-2'
    ]);
  });

  it('只注入 Agent 级 AGENTS.md，不读取全局 AGENTS.md', () => {
    const globalAgents = path.join(tempDir, 'AGENTS.md');
    const agentHome = path.join(tempDir, 'agent-home');
    fs.mkdirSync(agentHome, { recursive: true });
    fs.writeFileSync(globalAgents, 'global rule', 'utf-8');
    fs.writeFileSync(path.join(agentHome, 'AGENTS.md'), 'agent rule', 'utf-8');

    const service = new PromptAssemblyService();
    const blocks = service.assemble({
      globalAgentsMdPath: globalAgents,
      agentHome
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe('agent_rules');
    expect(blocks[0].content).toContain('agent rule');
    expect(blocks[0].content).not.toContain('global rule');
  });

  it('跳过模板-only Agent 规则', () => {
    const agentHome = path.join(tempDir, 'agent-home');
    fs.mkdirSync(agentHome, { recursive: true });
    fs.writeFileSync(path.join(agentHome, 'AGENTS.md'), '# Agent Rules\n\n<!-- template -->', 'utf-8');

    const service = new PromptAssemblyService();
    const blocks = service.assemble({ agentHome });

    expect(blocks).toHaveLength(0);
  });

  it('读取 project 根目录下的 Markdown 上下文文件并应用大小限制', () => {
    fs.writeFileSync(path.join(tempDir, 'a.md'), 'A'.repeat(200), 'utf-8');
    fs.writeFileSync(path.join(tempDir, 'b.txt'), 'ignore', 'utf-8');

    const service = new PromptAssemblyService();
    const blocks = service.assemble({
      project: tempDir,
      limits: {
        projectTotalChars: 500,
        projectFileChars: 40
      }
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe('project_context');
    expect(blocks[0].content).toContain('<project_context>');
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
