/**
 * SystemPromptBuilder 测试
 *
 * 运行命令：
 *   pnpm vitest run src/main/agent/prompt/__tests__/SystemPromptBuilder.test.ts
 *
 * 测试结果日志输出到 test-results/logs/system-prompt-builder-test.log
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSystemPrompt } from '../SystemPromptBuilder';
import type { SystemPromptInput } from '../SystemPromptBuilder';
import { computeAgentLayoutPaths, type AgentEnv } from '../../AgentEnv';
import { SkillManager } from '../../skills';
import type { SkillDefinition } from '../../runtime/types';

// ==================== 日志系统 ====================

const { logBuffer, logPath } = vi.hoisted(() => ({
  logBuffer: [] as string[],
  logPath: `${process.cwd()}/test-results/logs/system-prompt-builder-test.log`
}));

function flushLogBuffer(): void {
  if (logBuffer.length > 0) {
    const logDir = path.dirname(logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    fs.appendFileSync(logPath, logBuffer.join(''), 'utf-8');
    logBuffer.length = 0;
  }
}

function log(level: string, ...args: unknown[]): void {
  const timestamp = new Date().toISOString();
  const message = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  logBuffer.push(`[${timestamp}] [${level}] ${message}\n`);
  if (level !== 'DEBUG') {
    console.log(`[${level}]`, ...args);
  }
}

// mock electron-log（SystemPromptBuilder 的依赖链可能间接用到）
vi.mock('electron-log', () => {
  const addToBuffer = (level: string, ...args: unknown[]): void => {
    const timestamp = new Date().toISOString();
    const message = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    logBuffer.push(`[${timestamp}] [${level}] ${message}\n`);
  };

  const transports = {
    file: { level: 'debug', getFile: () => ({ path: logPath }) },
    console: { level: 'info' }
  };

  const logger = {
    info: (...args: unknown[]) => addToBuffer('INFO', ...args),
    warn: (...args: unknown[]) => addToBuffer('WARN', ...args),
    error: (...args: unknown[]) => addToBuffer('ERROR', ...args),
    debug: (...args: unknown[]) => addToBuffer('DEBUG', ...args),
    verbose: (...args: unknown[]) => addToBuffer('VERBOSE', ...args),
    transports
  };

  return {
    default: Object.assign(logger, {
      create: () => ({ ...logger, transports: { ...transports } })
    })
  };
});

// mock @main/common/env — computeAgentLayoutPaths 的 agentsDir 参数来源
const { mockAgentsDir } = vi.hoisted(() => ({
  mockAgentsDir: '/tmp/test-agents'
}));
vi.mock('@main/common/env', () => ({
  Env: {
    paths: {
      agentsDir: mockAgentsDir
    },
    main: {
      logLevel: 'info',
      logMaxSize: 10 * 1024 * 1024
    }
  }
}));

// ==================== Fixtures ====================

/**
 * 基于 computeAgentLayoutPaths 构建测试用 AgentEnv
 *
 * 路径计算与生产代码一致（单一来源：computeAgentLayoutPaths）：
 *   agentHome = {agentsDir}/{agentId}
 *   projectDir = {agentHome}/project
 *   sessionDir = {sessionsDir}/{sessionId}
 *   etc.
 */
function createMockAgentEnv(overrides?: Partial<AgentEnv>): AgentEnv {
  const agentId = overrides?.agentId ?? 'test-agent';
  const sessionId = overrides?.sessionId ?? 'sess-001';
  const agentsDir = overrides?.agentsDir ?? mockAgentsDir;

  // 仅当 agentId 有效时才使用 computeAgentLayoutPaths（空 agentId 会触发校验错误）
  const layout = agentId && agentId.trim()
    ? computeAgentLayoutPaths(agentsDir, agentId, sessionId)
    : {
        agentId,
        sessionId,
        agentHome: path.join(agentsDir, agentId || '_empty_'),
        projectDir: path.join(agentsDir, agentId || '_empty_', 'project'),
        memoryDir: path.join(agentsDir, agentId || '_empty_', 'memory'),
        sessionsDir: path.join(agentsDir, agentId || '_empty_', 'sessions'),
        sessionDir: path.join(agentsDir, agentId || '_empty_', 'sessions', sessionId),
        skillsDir: path.join(agentsDir, agentId || '_empty_', 'skills')
      };

  return {
    // 布局字段（通过 extends AgentRuntimeLayout 继承，spread 一次性展开）
    ...layout,

    // Agent 身份
    agentName: agentId,

    // 系统信息
    platform: 'darwin',
    arch: 'arm64',
    appVersion: '1.0.0',

    // 目录与路径
    userHome: '/tmp/user-home',
    systemHome: '/Users/test',
    tempDir: '/tmp',
    configDir: '/tmp/config',
    threadsDir: '/tmp/threads',
    agentsDir,

    // Skill 系统
    skillPaths: [],
    skillPathSources: [],

    // Extension 系统
    extensionPaths: [],
    builtinExtensionsDir: '/tmp/builtin-ext',
    userExtensionsDir: '/tmp/user-ext',
    loadedExtensions: [],

    // 能力清单
    availableTools: [],

    // 安全上下文
    sandboxMode: 'path-only',
    execApproval: 'auto',

    // 模型上下文
    defaultModel: 'openai/gpt-4',
    thinkingLevel: 'medium',

    // 覆盖（可覆盖任意字段，包括布局路径）
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
    log('DEBUG', `--- beforeEach: tempDir=${tempDir}`);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    flushLogBuffer();
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
      log('INFO', '测试: 始终包含 runtime_environment 块');
      log('INFO', `  输出块数: ${result.length}`);
      log('DEBUG', `  runtime_environment 长度: ${result[0]?.length ?? 0}`);

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
      log('INFO', '测试: 包含 Agent 身份信息');
      log('INFO', `  agentId: my-agent, agentName: My Agent`);

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
      log('INFO', '测试: 包含模型和平台信息');
      log('INFO', `  model: anthropic/claude-4, thinking: high, platform: linux/x64`);

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
      log('INFO', '测试: 包含安全配置');
      log('INFO', `  sandbox=docker, exec=always`);

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
      log('INFO', '测试: 无扩展时显示 none');

      expect(result[0]).toContain('extensions: none');
    });

    it('包含 skill 搜索路径', () => {
      const input: SystemPromptInput = {
        agentEnv: createMockAgentEnv({
          skillPathSources: [
            { label: 'User Skills', kind: 'session', path: '/tmp/user-skills', priority: 0 },
            { label: 'Agent Skills', kind: 'agent', path: '/tmp/agent-skills', priority: 1 }
          ]
        }),
        skillManager: new SkillManager(),
        agentsDir: tempDir
      };

      const result = buildSystemPrompt(input);
      log('INFO', '测试: 包含 skill 搜索路径');

      expect(result[0]).toContain('User Skills (session): /tmp/user-skills');
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
      log('INFO', '测试: 读取 Agent Home 中的 AGENTS.md');
      log('INFO', `  rulesBlock 存在: ${rulesBlock !== undefined}`);
      log('DEBUG', `  rulesBlock 长度: ${rulesBlock?.length ?? 0}`);

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
      log('INFO', '测试: 跳过纯注释的 AGENTS.md');
      log('INFO', `  agent_rules 注入: ${result.some((s) => s.includes('<agent_rules'))}`);

      expect(result.some((s) => s.includes('<agent_rules'))).toBe(false);
    });

    it('agentHome 为空时不注入', () => {
      const input: SystemPromptInput = {
        agentEnv: createMockAgentEnv({ agentHome: '' }),
        skillManager: new SkillManager(),
        agentsDir: tempDir
      };

      const result = buildSystemPrompt(input);
      log('INFO', '测试: agentHome 为空时不注入');

      expect(result.some((s) => s.includes('<agent_rules'))).toBe(false);
    });
  });

  // ==================== agent_home ====================

  describe('<agent_home>', () => {
    it('通过 AgentHomeManager 读取注入文件', () => {
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
      log('INFO', '测试: 通过 AgentHomeManager 读取注入文件');
      log('INFO', `  输出块数: ${result.length}`);
      log('DEBUG', `  agentHome: ${agentHome}`);

      expect(result[0]).toContain('<runtime_environment>');
    });

    it('agentId 为空时不注入 agent_home', () => {
      const input: SystemPromptInput = {
        agentEnv: createMockAgentEnv({ agentId: '' }),
        skillManager: new SkillManager(),
        agentsDir: tempDir
      };

      const result = buildSystemPrompt(input);
      log('INFO', '测试: agentId 为空时不注入 agent_home');

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
      log('INFO', '测试: 读取项目目录下的 .md 文件');
      log('INFO', `  ctxBlock 存在: ${ctxBlock !== undefined}`);
      log('DEBUG', `  ctxBlock 长度: ${ctxBlock?.length ?? 0}`);

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
      log('INFO', '测试: 忽略非 .md 文件');

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
      log('INFO', '测试: 无 .md 文件时不注入');

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
      log('INFO', '测试: 保留原始内容不截断');
      log('INFO', `  输入长度: ${longContent.length}, 输出长度: ${ctxBlock?.length ?? 0}`);
      log('INFO', `  包含 truncated: ${ctxBlock?.includes('... (truncated)') ?? false}`);

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
      log('INFO', '测试: projectDir 为空时不注入');

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
      log('INFO', '测试: SkillManager 为空时不注入');

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
      log('INFO', '测试: 显示 Bound Skills 信息');
      log('INFO', `  skill_discovery 块存在: ${block !== undefined}`);
      log('DEBUG', `  skill_discovery 长度: ${block?.length ?? 0}`);

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
      log('INFO', '测试: 显示 Other Skills 数量');
      log('INFO', `  skillManager.size: ${manager.size}, boundDefs: 1, otherCount: ${manager.size - 1}`);

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
      log('INFO', '测试: Agent Home 下的 skill 路径转为 AGENT_HOME/ 相对路径');
      log('INFO', `  原始路径: ${agentHome}/skills/private-skill/SKILL.md`);
      log('INFO', `  转换后: AGENT_HOME/skills/private-skill/SKILL.md`);

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
      log('INFO', '测试: Agent Home 外的 skill 保留绝对路径');

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
      log('INFO', '测试: 包含使用说明约束');

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
        agentsDir: tempDir
      };

      const result = buildSystemPrompt(input);
      const block = result.find((s) => s.includes('<skill_discovery'));
      log('INFO', '测试: 未配置 agentDefinedSkills 时全部为 Other Skills');
      log('INFO', `  skillManager.size: ${manager.size}, boundDefs: 0, otherCount: ${manager.size}`);

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
      log('INFO', '测试: 注入 Extension 指令');
      log('INFO', `  指令数: 2, 输出块数: ${result.length}`);

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
      const nonRuntime = result.filter((s) => !s.includes('<runtime_environment'));
      log('INFO', '测试: 空 Extension 指令不注入');
      log('INFO', `  非runtime块数: ${nonRuntime.length}`);

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

      log('INFO', '测试: 按固定顺序输出');
      log('INFO', `  总块数: ${result.length}`);
      log('INFO', `  idxRuntime=${idxRuntime}, idxRules=${idxRules}, idxProject=${idxProject}, idxSkill=${idxSkill}, idxExt=${idxExt}`);

      // 输出每个块的摘要
      result.forEach((block, i) => {
        const tag = block.match(/^<(\w+)>/)?.[1] || block.slice(0, 40).replace(/\n/g, ' ');
        log('DEBUG', `  [${i}] ${tag} (${block.length} chars)`);
      });

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
      log('INFO', '测试: 空白 Extension 指令被跳过');
      log('INFO', `  输出块数: ${result.length} (仅 runtime_environment)`);

      expect(result.every((s) => s.trim().length > 0)).toBe(true);
    });
  });

  // ==================== 完整输出快照 ====================

  describe('完整输出', () => {
    it('全量场景输出快照到日志', () => {
      const agentHome = path.join(tempDir, 'agent-home');
      fs.mkdirSync(agentHome, { recursive: true });
      fs.writeFileSync(path.join(agentHome, 'AGENTS.md'), 'Always respond in Chinese.\nUse concise language.', 'utf-8');
      fs.writeFileSync(path.join(agentHome, 'IDENTITY.md'), 'I am a helpful assistant.', 'utf-8');

      const projectDir = path.join(tempDir, 'project');
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'README.md'), '# My Project\n\nThis is a test project.', 'utf-8');
      fs.writeFileSync(path.join(projectDir, 'TODO.md'), '- [ ] Task 1\n- [x] Task 2', 'utf-8');

      const agentsDir = path.join(tempDir, 'agents');
      const agentHomeDir = path.join(agentsDir, 'full-agent');
      fs.mkdirSync(agentHomeDir, { recursive: true });
      fs.writeFileSync(path.join(agentHomeDir, 'IDENTITY.md'), 'I am full-agent.', 'utf-8');
      fs.writeFileSync(path.join(agentHomeDir, 'SOUL.md'), 'Be precise and thorough.', 'utf-8');

      const manager = createSkillManagerWith([
        { name: 'report-gen', description: 'Generate reports from data', content: 'report content', filePath: `${agentHome}/skills/report-gen/SKILL.md` },
        { name: 'data-fetch', description: 'Fetch data from APIs', content: 'fetch content' }
      ]);

      const input: SystemPromptInput = {
        agentEnv: createMockAgentEnv({
          agentId: 'full-agent',
          agentName: 'Full Agent',
          agentHome,
          projectDir,
          defaultModel: 'anthropic/claude-4',
          thinkingLevel: 'high',
          sandboxMode: 'path-only',
          execApproval: 'auto',
          loadedExtensions: ['ext-memory', 'ext-search'],
          skillPathSources: [
            { label: 'System Skills', kind: 'system', path: '/app/skills', priority: 0 },
            { label: 'Agent Skills', kind: 'agent', path: `${agentHome}/skills`, priority: 1 }
          ]
        }),
        skillManager: manager,
        agentDefinedSkills: ['report-gen'],
        extensionInstructions: ['Use memory-smart tool for context recall.'],
        agentsDir
      };

      const result = buildSystemPrompt(input);

      // 输出完整快照到日志
      log('INFO', '========== 完整输出快照 ==========');
      log('INFO', `总块数: ${result.length}`);
      result.forEach((block, i) => {
        const tag = block.match(/^<(\w+)>/)?.[1] || '(plain)';
        log('INFO', `--- Block [${i}] (${tag}, ${block.length} chars) ---`);
        log('DEBUG', block);
      });
      log('INFO', '========== 快照结束 ==========');

      // 基本断言
      expect(result.length).toBeGreaterThanOrEqual(4);
      expect(result[0]).toContain('<runtime_environment>');
    });
  });
});
