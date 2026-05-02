/**
 * 系统提示词构建器
 *
 * 统一管理注入到系统提示词的所有 XML 块：
 *   - <runtime_environment> — Agent 运行时路径与环境信息
 *   - <agent_rules>         — Agent Home 中的 AGENTS.md 规则
 *   - <agent_home>          — Agent Home 可注入文件（IDENTITY.md / SOUL.md 等）
 *   - <project_context>     — 项目目录下的 .md 文件
 *   - <skill_discovery>     — Skill 发现提示（双档策略）
 *   - Extension 注入指令
 *
 * 输入：AgentEnv + SkillManager + Agent 配置
 * 输出：string[] (appendInstructions)
 *
 * 不做截断，保留原始大小。
 */

import fs from 'node:fs';
import path from 'node:path';
import type { AgentEnv } from '../AgentEnv';
import { SkillManager } from '../skills';
import type { SkillDefinition } from '../runtime/types';
import { AgentHomeManager } from '../agents/AgentHomeManager';

// ==================== 输入类型 ====================

export interface SystemPromptInput {
  /** Agent 运行时环境 */
  agentEnv: AgentEnv;
  /** Skill 管理器（已完成扫描注册） */
  skillManager: SkillManager;
  /** Agent 配置中声明的 skill 名称列表 */
  agentDefinedSkills?: string[];
  /** Extension 注入的指令列表 */
  extensionInstructions?: string[];
  /** Agent 集中存储目录（{userHome}/agents/） */
  agentsDir: string;
}

// ==================== 公共入口 ====================

/**
 * 一站式构建系统提示词注入块
 *
 * 整合 runtime_environment + agent_rules + agent_home + project_context
 * + skill_discovery + extension_instructions，
 * 返回 appendInstructions。
 */
export function buildSystemPrompt(input: SystemPromptInput): string[] {
  const { agentEnv, skillManager, agentDefinedSkills, extensionInstructions, agentsDir } = input;

  const instructions: string[] = [];

  // 1. <runtime_environment>
  addInstruction(instructions, formatRuntimeEnvironment(agentEnv));

  // 2. <agent_rules> — Agent Home 中的 AGENTS.md
  addInstruction(instructions, readAgentRulesFile(agentEnv.agentHome));

  // 3. <agent_home> — Agent Home 可注入文件（IDENTITY.md / SOUL.md 等）
  const homeManager = new AgentHomeManager(agentsDir);
  addInstruction(instructions, readAgentHomeFiles(homeManager, agentEnv.agentId));

  // 4. <project_context> — 项目目录下的 .md 文件
  addInstruction(instructions, readProjectContextFiles(agentEnv.projectDir));

  // 5. <skill_discovery>
  addInstruction(instructions, buildSkillDiscoveryBlock(skillManager, agentDefinedSkills));

  // 6. Extension 注入指令
  for (const instruction of extensionInstructions || []) {
    addInstruction(instructions, instruction);
  }

  return instructions;
}

// ==================== 辅助 ====================

/** 非空内容加入列表 */
function addInstruction(list: string[], content: string | undefined): void {
  const normalized = content?.trim();
  if (normalized) {
    list.push(normalized);
  }
}

// ==================== 文件读取（无截断） ====================

/**
 * 读取 Agent Home 中的 AGENTS.md 规则文件
 */
function readAgentRulesFile(agentHome: string | undefined): string | undefined {
  const agentMdPath = agentHome ? path.join(agentHome, 'AGENTS.md') : undefined;
  const agentContent = agentMdPath ? readText(agentMdPath) : undefined;

  if (!agentMdPath || !agentContent || isOnlyComments(agentContent)) {
    return undefined;
  }

  return `<agent_rules path="${agentMdPath}">\n${agentContent}\n</agent_rules>`;
}

/**
 * 读取 Agent Home 可注入文件（IDENTITY.md / SOUL.md 等）
 */
function readAgentHomeFiles(manager: AgentHomeManager, agentId: string | undefined): string | undefined {
  if (!agentId) return undefined;
  return manager.readInjectableFiles(agentId);
}

/**
 * 读取项目目录下的 .md 文件
 */
function readProjectContextFiles(project: string | undefined): string | undefined {
  if (!project) return undefined;

  try {
    const entries = fs.readdirSync(project, { withFileTypes: true });
    const mdFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort();

    if (mdFiles.length === 0) return undefined;

    const sections: string[] = [];

    for (const file of mdFiles) {
      const filePath = path.join(project, file);
      const content = readText(filePath);
      if (!content) continue;

      sections.push(`### ${file}\n\n${content}`);
    }

    if (sections.length === 0) return undefined;

    return `<project_context>
Agent-persistent context files from the project root.
These were created in previous conversation turns and auto-loaded for continuity.
You may update or add new files in the project root to persist information across turns.

${sections.join('\n\n---\n\n')}
</project_context>`;
  } catch {
    return undefined;
  }
}

function readText(filePath: string): string | undefined {
  try {
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    return content || undefined;
  } catch {
    return undefined;
  }
}

function isOnlyComments(content: string): boolean {
  const stripped = content
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('<!--') && !trimmed.endsWith('-->');
    })
    .join('')
    .trim();
  return stripped.length === 0;
}

// ==================== XML 块构建 ====================

/**
 * 构建 <runtime_environment> XML 块
 *
 * 向 LLM 描述 Agent 运行时的完整环境信息：
 * 系统平台、会话 ID、目录路径、安全配置、可用扩展等。
 */
function formatRuntimeEnvironment(env: AgentEnv): string {
  const extensionsList = env.loadedExtensions.length > 0 ? env.loadedExtensions.join(', ') : 'none';
  const skillPathsList =
    env.skillPathSources.length > 0
      ? '\n' + env.skillPathSources.map((source) => `  - ${source.label} (${source.kind}): ${source.path}`).join('\n')
      : ' none';

  return `<runtime_environment>
Agent:
- id: ${env.agentId}
- name: ${env.agentName}
- Session: ${env.sessionId}
- model: ${env.defaultModel} (thinking=${env.thinkingLevel})
- platform: ${env.platform}/${env.arch}
- security: sandbox=${env.sandboxMode}, exec=${env.execApproval}
- extensions: ${extensionsList}

Paths:
- session_dir: ${env.sessionDir} (current conversation artifacts)
- agent_home: ${env.agentHome} (identity, memory, and Agent-level configuration)
- project_dir: ${env.projectDir} (tool cwd and durable business project)
- memory_dir: ${env.memoryDir} (persistent memory storage)
- sessions_dir: ${env.sessionsDir} (all session artifacts)
- skills_dir: ${env.skillsDir} (Agent-level skills)
- config: ${env.configDir}
- skill_search_paths:${skillPathsList}
- agents_definitions: ${env.agentsDir}

File usage:
- Save durable business data, records, reports, and knowledge documents in the project directory.
- Use agent_home only for Agent identity, memory, preferences, rules, and configuration.
- Use project for tool outputs, generated reports, indexes, and intermediate files.
- Do not manually edit system-managed session files: session_dir/history.jsonl, session_dir/events.jsonl, session_dir/context.jsonl.
</runtime_environment>`;
}

/**
 * 构建 <skill_discovery> XML 块
 *
 * 双档策略：
 *   1. 固有技能包（Bound Skills）：agent.skills 显式声明的 skill，
 *      名称 + 描述 + SKILL.md 相对路径 直接固化到上下文；
 *   2. 其他扫描到的技能（Other Skills）：仅给出数量提示，让 LLM 按需通过 skill_list 发现。
 *
 * 并附加三条硬约束，防止 LLM 把 skill 名当 function tool 直接调用造成幻觉。
 */
function buildSkillDiscoveryBlock(
  skillManager: SkillManager,
  agentDefinedSkills: string[] | undefined
): string {
  if (skillManager.size === 0) {
    return '';
  }

  const boundDefs = (agentDefinedSkills || [])
    .map((name) => skillManager.getByName(name))
    .filter((s): s is SkillDefinition => !!s);

  const lines: string[] = ['<skill_discovery>'];

  if (boundDefs.length > 0) {
    lines.push(`## Bound Skills (${boundDefs.length})`);
    lines.push('');
    lines.push('These skills are bound to this agent. Their metadata is listed below;');
    lines.push('read the referenced SKILL.md file (absolute path) before using any of them.');
    lines.push('');
    for (const def of boundDefs) {
      const displayPath = def.filePath || '';
      const desc = (def.description || '').trim() || '(no description)';
      const pathHint = displayPath ? ` — \`${displayPath}\`` : '';
      lines.push(`- **${def.name}** — ${desc}${pathHint}`);
    }
    lines.push('');
  }

  const otherCount = Math.max(0, skillManager.size - boundDefs.length);
  if (otherCount > 0) {
    lines.push(`## Other Skills (${otherCount})`);
    lines.push('');
    lines.push(
      `There are ${otherCount} additional skills available. Use the \`skill_list\` tool to discover them on demand.`
    );
    lines.push('');
  }

  lines.push('## How to Use a Skill');
  lines.push('');
  lines.push(
    '1. **Read SKILL.md first.** Use the `read` tool on the path above (or a path returned by `skill_list`) before acting on any skill. Never skip this step.'
  );
  lines.push(
    '2. **Execute scripts via `exec`.** Skill scripts (python/shell/etc.) must be invoked through the `exec` tool as shell commands. Skill names and script filenames are NOT function tools — calling them directly will fail with "Tool not found".'
  );
  lines.push(
    '3. **No hallucination.** Never claim a skill has been invoked or a step has been completed unless you actually called the corresponding tool and received a successful result.'
  );

  lines.push('</skill_discovery>');
  return lines.join('\n');
}
