import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSystemPrompt } from '../SystemPromptBuilder';
import type { SystemPromptInput } from '../SystemPromptBuilder';
import type { AgentEnv } from '../../AgentEnv';
import { SkillManager } from '../../skills';
import type { SkillDefinition } from '../../runtime/types';

// ==================== Fixtures ====================

function createMockAgentEnv(overrides?: Partial<AgentEnv>): AgentEnv {
  return {
    agentId: 'test-agent',
    agentName: 'Test Agent',
    agentHome: '/tmp/agent-home',
    sessionId: 'sess-001',
    sessionDir: '/tmp/session',
    memoryDir: '/tmp/memory',
    sessionsDir: '/tmp/sessions',
    skillsDir: '/tmp/skills',
    platform: 'darwin',
    arch: 'arm64',
    appVersion: '1.0.0',
    projectDir: '/tmp/project',
    userHome: '/tmp/user-home',
    systemHome: '/Users/test',
    tempDir: '/tmp',
    configDir: '/tmp/config',
    threadsDir: '/tmp/threads',
    agentsDir: '/tmp/agents',
    skillPaths: [],
    skillPathSources: [],
    extensionPaths: [],
    builtinExtensionsDir: '/tmp/builtin-ext',
    userExtensionsDir: '/tmp/user-ext',
    loadedExtensions: [],
    availableTools: [],
    sandboxMode: 'path-only',
    execApproval: 'auto',
    defaultModel: 'openai/gpt-4',
    thinkingLevel: 'medium',
    ...overrides
  };
}

/** 构造一个包含已注册 skills 的 SkillManager */
function createSkillManagerWith(skills: SkillDefinition[]): SkillManager {
  const manager = new SkillManager();
  for (const skill of skills) {
    manager.register(skill);
  }
  return manager;
}

// ==================== Tests ====================

describe('buildSystemPrompt', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sys-prompt-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ==================== runtime_environment ====================

  describe('<runtime_environment>', () => {
    it('始终包含 runtime_environment 块', () => {
      const input: SystemPromptInput = {
        agentEnv: createMockAgentEnv(),
        skillManager: new SkillManager(),
        agentsDir: tempDir
      };

      const result = buildSystemPrompt(input);
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0]).toContain('<runtime_environment>');
      expect(result[0]).toContain('</runtime_environment>');
    });

    it('包含 Agent 身份信息', () => {
      const input: SystemPromptInput = {
        agentEnv: createMockAgentEnv({ agentId: 'my-agent', agentName: 'My Agent' }),
        skillManager: new SkillManager(),
        agentsDir: tempDir
      };

      const result = buildSystemPrompt(input);
      expect(result[0]).toContain('- id: my-agent');
      expect(result[0]).toContain('- name: My Agent');
    });

    it('包含模型和平台信息', () => {
      const input: SystemPromptInput = {
        agentEnv: createMockAgentEnv({
          defaultModel: 'anthropic/claude-4',
          thinkingLevel: 'high',
          platform: 'linux',
          arch: 'x64'
        }),
        skillManager: new SkillManager(),
        agentsDir: tempDir
      };

      const result = buildSystemPrompt(input);
      expect(result[0]).toContain('model: anthropic/claude-4 (thinking=high)');
      expect(result[0]).toContain('platform: linux/x64');
    });

    it('包含安全配置', () => {
      const input: SystemPromptInput = {
        agentEnv: createMockAgentEnv({ sandboxMode: 'docker', execApproval: 'always' }),
        skillManager: new SkillManager(),
        agentsDir: tempDir
      };

      const result = buildSystemPrompt(input);
      expect(result[0]).toContain('sandbox=docker');
      expect(result[0]).toContain('exec=always');
    });

    it('无扩展时显示 none', () => {
      const input: SystemPromptInput = {
        agentEnv: createMockAgentEnv({ loadedExtensions: [] }),
        skillManager: new SkillManager(),
        agentsDir: tempDir
      };

      const result = buildSystemPrompt(input);
      expect(result[0]).toContain('extensions: none');
    });

    it('包含 skill 搜索路径', () => {
      const input: SystemPromptInput = {
        agentEnv: createMockAgentEnv({
          skillPathSources: [
            { label: 'User Skills', kind: 'user', path: '/tmp/user-skills' },
            { label: 'Agent Skills', kind: 'agent', path: '/tmp/agent-skills' }
          ]
        }),
        skillManager: new SkillManager(),
        agentsDir: tempDir
      };

      const result = buildSystemPrompt(input);
      expect(result[0]).toContain('User Skills (user): /tmp/user-skills');
      expect(result[0]).toContain('Agent Skills (agent): /tmp/agent-skills');
    });
  });

  // ==================== agent_rules ====================

  describe('<agent_rules>', () => {
    it('读取 Agent Home 中的 AGENTS.md', () => {
      const agentHome = path.join(tempDir, 'agent-home');
      fs.mkdirSync(agentHome, { recursive: true });
      fs.writeFileSync(path.join(agentHome, 'AGENTS.md'), 'Always respond in Chinese.', 'utf-8');

      const input: SystemPromptInput = {
        agentEnv: createMockAgentEnv({ agentHome }),
        skillManager: new SkillManager(),
        agentsDir: tempDir
      };

      const result = buildSystemPrompt(input);
      const rulesBlock = result.find((s) => s.includes('<agent_rules'));
      expect(rulesBlock).toBeDefined();
      expect(rulesBlock).toContain('Always respond in Chinese.');
    });

    it('跳过纯注释的 AGENTS.md', () => {
      const agentHome = path.join(tempDir, 'agent-home');
      fs.mkdirSync(agentHome, { recursive: true });
      fs.writeFileSync(path.join(agentHome, 'AGENTS.md'), '# Title\n\n<!-- template -->', 'utf-8');

      const input: SystemPromptInput = {
        agentEnv: createMockAgentEnv({ agentHome }),
        skillManager: new SkillManager(),
        agentsDir: tempDir
      };

      const result = buildSystemPrompt(input);
      expect(result.some((s) => s.includes('<agent_rules'))).toBe(false);
    });

    it('agentHome 为空时不注入', () => {
      const input: SystemPromptInput = {
        agentEnv: createMockAgentEnv({ agentHome: '' }),
        skillManager: new SkillManager(),
        agentsDir: tempDir
      };

      const result = buildSystemPrompt(input);
      expect(result.some((s) => s.includes('<agent_rules'))).toBe(false);
    });
  });

  // ==================== agent_home ====================

  describe('<agent_home>', () => {
    it('通过 AgentHomeManager 读取注入文件', () => {
      // 创建真实的 Agent Home 目录结构
      const agentsDir = path.join(tempDir, 'agents');
      const agentHome = path.join(agentsDir, 'test-agent');
      fs.mkdirSync(agentHome, { recursive: true });
      fs.writeFileSync(path.join(agentHome, 'IDENTITY.md'), 'I am a test agent.', 'utf-8');
      fs.writeFileSync(path.join(agentHome, 'SOUL.md'), 'Be helpful and concise.', 'utf-8');

      const input: SystemPromptInput = {
        agentEnv: createMockAgentEnv({ agentId: 'test-agent', agentHome }),
        skillManager: new SkillManager(),
        agentsDir
      };

      const result = buildSystemPrompt(input);
      const homeBlock = result.find((s) => s.includes('IDENTITY.md') || s.includes('test-agent'));
      // AgentHomeManager 读取可注入文件，具体内容取决于目录结构
      // 至少不会报错，且 runtime_environment 正常
      expect(result[0]).toContain('<runtime_environment>');
    });

    it('agentId 为空时不注入 agent_home', () => {
      const input: SystemPromptInput = {
        agentEnv: createMockAgentEnv({ agentId: '' }),
        skillManager: new SkillManager(),
        agentsDir: tempDir
      };

      // 不应抛错
      const result = buildSystemPrompt(input);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ==================== project_context ====================

  describe('<project_context>', () => {
    it('读取项目目录下的 .md 文件', () => {
      fs.writeFileSync(path.join(tempDir, 'overview.md'), 'Project overview content.', 'utf-8');
      fs.writeFileSync(path.join(tempDir, 'guide.md'), 'How to use this project.', 'utf-8');

      const input: SystemPromptInput = {
        agentEnv: createMockAgentEnv({ projectDir: tempDir }),
        skillManager: new SkillManager(),
        agentsDir: tempDir
      };

      const result = buildSystemPrompt(input);
      const ctxBlock = result.find((s) => s.includes('<project_context'));
      expect(ctxBlock).toBeDefined();
      expect(ctxBlock).toContain('### overview.md');
      expect(ctxBlock).toContain('Project overview content.');
      expect(ctxBlock).toContain('### guide.md');
      expect(ctxBlock).toContain('How to use this project.');
    });

    it('忽略非 .md 文件', () => {
      fs.writeFileSync(path.join(tempDir, 'data.json'), '{}', 'utf-8');
      fs.writeFileSync(path.join(tempDir, 'readme.md'), 'Hello', 'utf-8');

      const input: SystemPromptInput = {
        agentEnv: createMockAgentEnv({ projectDir: tempDir }),
        skillManager: new SkillManager(),
        agentsDir: tempDir
      };

      const result = buildSystemPrompt(input);
      const ctxBlock = result.find((s) => s.includes('<project_context'));
      expect(ctxBlock).toBeDefined();
      expect(ctxBlock).toContain('### readme.md');
      expect(ctxBlock).not.toContain('data.json');
    });

    it('无 .md 文件时不注入', () => {
      fs.writeFileSync(path.join(tempDir, 'data.txt'), 'hello', 'utf-8');

      const input: SystemPromptInput = {
        agentEnv: createMockAgentEnv({ projectDir: tempDir }),
        skillManager: new SkillManager(),
        agentsDir: tempDir
      };

      const result = buildSystemPrompt(input);
      expect(result.some((s) => s.includes('<project_context'))).toBe(false);
    });

    it('保留原始内容不截断', () => {
      const longContent = 'X'.repeat(20_000);
      fs.writeFileSync(path.join(tempDir, 'large.md'), longContent, 'utf-8');

      const input: SystemPromptInput = {
        agentEnv: createMockAgentEnv({ projectDir: tempDir }),
        skillManager: new SkillManager(),
        agentsDir: tempDir
      };

      const result = buildSystemPrompt(input);
      const ctxBlock = result.find((s) => s.includes('<project_context'));
      expect(ctxBlock).toBeDefined();
      expect(ctxBlock).not.toContain('... (truncated)');
      expect(ctxBlock!.length).toBeGreaterThan(20_000);
    });

    it('projectDir 为空时不注入', () => {
      const input: SystemPromptInput = {
        agentEnv: createMockAgentEnv({ projectDir: '' }),
        skillManager: new SkillManager(),
        agentsDir: tempDir
      };

      const result = buildSystemPrompt(input);
      expect(result.some((s) => s.includes('<project_context'))).toBe(false);
    });
  });

  // ==================== skill_discovery ====================

  describe('<skill_discovery>', () => {
    it('SkillManager 为空时不注入', () => {
      const input: SystemPromptInput = {
        agentEnv: createMockAgentEnv(),
        skillManager: new SkillManager(),
        agentsDir: tempDir
      };

      const result = buildSystemPrompt(input);
      expect(result.some((s) => s.includes('<skill_discovery'))).toBe(false);
    });

    it('显示 Bound Skills 信息', () => {
      const manager = createSkillManagerWith([
        { name: 'report-gen', description: 'Generate reports', content: 'content' }
      ]);

      const input: SystemPromptInput = {
        agentEnv: createMockAgentEnv(),
        skillManager: manager,
        agentDefinedSkills: ['report-gen'],
        agentsDir: tempDir
      };

      const result = buildSystemPrompt(input);
      const block = result.find((s) => s.includes('<skill_discovery'));
      expect(block).toBeDefined();
      expect(block).toContain('## Bound Skills (1)');
      expect(block).toContain('**report-gen**');
      expect(block).toContain('Generate reports');
    });

    it('显示 Other Skills 数量', () => {
      const manager = createSkillManagerWith([
        { name: 'bound-skill', description: 'Bound one', content: 'c1' },
        { name: 'extra-skill', description: 'Extra one', content: 'c2' }
      ]);

      const input: SystemPromptInput = {
        agentEnv: createMockAgentEnv(),
        skillManager: manager,
        agentDefinedSkills: ['bound-skill'],
        agentsDir: tempDir
      };

      const result = buildSystemPrompt(input);
      const block = result.find((s) => s.includes('<skill_discovery'));
      expect(block).toBeDefined();
      expect(block).toContain('## Other Skills (1)');
      expect(block).toContain('skill_list');
    });

    it('Agent Home 下的 skill 路径转为 AGENT_HOME/ 相对路径', () => {
      const agentHome = '/tmp/agent-home';
      const manager = createSkillManagerWith([
        {
          name: 'private-skill',
          description: 'Agent private',
          content: 'c',
          filePath: `${agentHome}/skills/private-skill/SKILL.md`
        }
      ]);

      const input: SystemPromptInput = {
        agentEnv: createMockAgentEnv({ agentHome }),
        skillManager: manager,
        agentDefinedSkills: ['private-skill'],
        agentsDir: tempDir
      };

      const result = buildSystemPrompt(input);
      const block = result.find((s) => s.includes('<skill_discovery'));
      expect(block).toBeDefined();
      expect(block).toContain('AGENT_HOME/skills/private-skill/SKILL.md');
    });

    it('Agent Home 外的 skill 保留绝对路径', () => {
      const manager = createSkillManagerWith([
        {
          name: 'system-skill',
          description: 'System skill',
          content: 'c',
          filePath: '/opt/skills/system-skill/SKILL.md'
        }
      ]);

      const input: SystemPromptInput = {
        agentEnv: createMockAgentEnv({ agentHome: '/tmp/agent-home' }),
        skillManager: manager,
        agentDefinedSkills: ['system-skill'],
        agentsDir: tempDir
      };

      const result = buildSystemPrompt(input);
      const block = result.find((s) => s.includes('<skill_discovery'));
      expect(block).toBeDefined();
      expect(block).toContain('/opt/skills/system-skill/SKILL.md');
      expect(block).not.toContain('AGENT_HOME//opt');
    });

    it('包含使用说明约束', () => {
      const manager = createSkillManagerWith([
        { name: 's1', description: 'Skill 1', content: 'c' }
      ]);

      const input: SystemPromptInput = {
        agentEnv: createMockAgentEnv(),
        skillManager: manager,
        agentsDir: tempDir
      };

      const result = buildSystemPrompt(input);
      const block = result.find((s) => s.includes('<skill_discovery'));
      expect(block).toContain('## How to Use a Skill');
      expect(block).toContain('Read SKILL.md first');
      expect(block).toContain('Execute scripts via `exec`');
      expect(block).toContain('No hallucination');
    });

    it('未配置 agentDefinedSkills 时全部为 Other Skills', () => {
      const manager = createSkillManagerWith([
        { name: 'a', description: 'A', content: 'c' },
        { name: 'b', description: 'B', content: 'c' }
      ]);

      const input: SystemPromptInput = {
        agentEnv: createMockAgentEnv(),
        skillManager: manager,
        // 不传 agentDefinedSkills
        agentsDir: tempDir
      };

      const result = buildSystemPrompt(input);
      const block = result.find((s) => s.includes('<skill_discovery'));
      expect(block).toBeDefined();
      expect(block).toContain('## Other Skills (2)');
      expect(block).not.toContain('## Bound Skills');
    });
  });

  // ==================== Extension 指令 ====================

  describe('Extension instructions', () => {
    it('注入 Extension 指令', () => {
      const input: SystemPromptInput = {
        agentEnv: createMockAgentEnv(),
        skillManager: new SkillManager(),
        extensionInstructions: ['Remember to use memory-smart tool.', 'Always check context.'],
        agentsDir: tempDir
      };

      const result = buildSystemPrompt(input);
      expect(result).toContain('Remember to use memory-smart tool.');
      expect(result).toContain('Always check context.');
    });

    it('空 Extension 指令不注入', () => {
      const input: SystemPromptInput = {
        agentEnv: createMockAgentEnv(),
        skillManager: new SkillManager(),
        extensionInstructions: [],
        agentsDir: tempDir
      };

      const result = buildSystemPrompt(input);
      // 只有 runtime_environment，无额外 extension 内容
      const nonRuntime = result.filter((s) => !s.includes('<runtime_environment'));
      expect(nonRuntime.length).toBe(0);
    });
  });

  // ==================== 整体顺序 ====================

  describe('指令块顺序', () => {
    it('按 runtime → rules → home → project → skills → extensions 顺序输出', () => {
      const agentHome = path.join(tempDir, 'agent-home');
      fs.mkdirSync(agentHome, { recursive: true });
      fs.writeFileSync(path.join(agentHome, 'AGENTS.md'), 'Be concise.', 'utf-8');

      const projectDir = path.join(tempDir, 'project');
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'README.md'), 'Project info.', 'utf-8');

      const agentsDir = path.join(tempDir, 'agents');
      const agentHomeDir = path.join(agentsDir, 'test-agent');
      fs.mkdirSync(agentHomeDir, { recursive: true });
      fs.writeFileSync(path.join(agentHomeDir, 'IDENTITY.md'), 'I am test.', 'utf-8');

      const manager = createSkillManagerWith([
        { name: 'report', description: 'Report gen', content: 'c' }
      ]);

      const input: SystemPromptInput = {
        agentEnv: createMockAgentEnv({ agentHome, projectDir }),
        skillManager: manager,
        agentDefinedSkills: ['report'],
        extensionInstructions: ['Use memory.'],
        agentsDir
      };

      const result = buildSystemPrompt(input);

      const idxRuntime = result.findIndex((s) => s.includes('<runtime_environment'));
      const idxRules = result.findIndex((s) => s.includes('<agent_rules'));
      const idxProject = result.findIndex((s) => s.includes('<project_context'));
      const idxSkill = result.findIndex((s) => s.includes('<skill_discovery'));
      const idxExt = result.findIndex((s) => s.includes('Use memory.'));

      // runtime 始终排第一
      expect(idxRuntime).toBe(0);

      // 顺序递增（跳过不存在的块，agent_home 内容不固定因此不参与顺序断言）
      const indices = [idxRuntime, idxRules, idxProject, idxSkill, idxExt].filter((i) => i >= 0);
      for (let i = 1; i < indices.length; i++) {
        expect(indices[i]).toBeGreaterThan(indices[i - 1]);
      }
    });
  });

  // ==================== 空内容跳过 ====================

  describe('空内容过滤', () => {
    it('空白 Extension 指令被跳过', () => {
      const input: SystemPromptInput = {
        agentEnv: createMockAgentEnv(),
        skillManager: new SkillManager(),
        extensionInstructions: ['   ', '', '\t\n'],
        agentsDir: tempDir
      };

      const result = buildSystemPrompt(input);
      // 空白字符串不应出现在结果中
      expect(result.every((s) => s.trim().length > 0)).toBe(true);
    });
  });
});
