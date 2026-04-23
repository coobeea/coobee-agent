/**
 * PromptAssemblyService
 *
 * 统一管理运行期 prompt 附加块的读取、排序和大小限制。
 * AgentEnvInjector 只负责准备上下文，本服务负责把上下文装配成 appendInstructions。
 */

import fs from 'node:fs';
import path from 'node:path';
import type { AgentHomeManager } from '../agents/AgentHomeManager';

export interface PromptBlock {
  id: string;
  title: string;
  content: string;
  source?: string;
  charLength: number;
  estimatedTokens: number;
}

export interface PromptAssemblyParams {
  runtimePathsBlock?: string;
  globalAgentsMdPath?: string;
  agentHome?: string;
  agentId?: string;
  agentHomeManager?: AgentHomeManager;
  workspace?: string;
  skillDiscoveryHint?: string;
  extensionInstructions?: string[];
  limits?: {
    agentHomeChars?: number;
    agentsMdChars?: number;
    workspaceTotalChars?: number;
    workspaceFileChars?: number;
  };
}

const DEFAULT_LIMITS = {
  agentHomeChars: 10_000,
  agentsMdChars: 50_000,
  workspaceTotalChars: 6_000,
  workspaceFileChars: 3_000
};

export class PromptAssemblyService {
  assemble(params: PromptAssemblyParams): PromptBlock[] {
    const limits = { ...DEFAULT_LIMITS, ...params.limits };
    const blocks: PromptBlock[] = [];

    this.addBlock(blocks, 'runtime_paths', 'Runtime paths', params.runtimePathsBlock);
    this.addBlock(
      blocks,
      'agents_md',
      'AGENTS.md rules',
      this.readAgentsMdFiles(params.globalAgentsMdPath, params.agentHome, limits.agentsMdChars),
      params.globalAgentsMdPath
    );
    this.addBlock(
      blocks,
      'agent_home',
      'Agent Home files',
      this.readAgentHome(params.agentHomeManager, params.agentId, limits.agentHomeChars),
      params.agentHome
    );
    this.addBlock(
      blocks,
      'workspace_context',
      'Workspace context files',
      this.readWorkspaceContextFiles(params.workspace, limits.workspaceTotalChars, limits.workspaceFileChars),
      params.workspace
    );
    this.addBlock(blocks, 'skill_discovery', 'Skill discovery', params.skillDiscoveryHint);

    for (const [index, instruction] of (params.extensionInstructions || []).entries()) {
      this.addBlock(blocks, `extension_instruction_${index + 1}`, 'Extension instruction', instruction);
    }

    return blocks;
  }

  toInstructions(blocks: PromptBlock[]): string[] {
    return blocks.map((block) => block.content);
  }

  private addBlock(blocks: PromptBlock[], id: string, title: string, content?: string, source?: string): void {
    const normalized = content?.trim();
    if (!normalized) return;

    blocks.push({
      id,
      title,
      content: normalized,
      source,
      charLength: normalized.length,
      estimatedTokens: Math.ceil(normalized.length / 3)
    });
  }

  private readAgentHome(
    manager: AgentHomeManager | undefined,
    agentId: string | undefined,
    maxChars: number
  ): string | undefined {
    if (!manager || !agentId) return undefined;
    const content = manager.readInjectableFiles(agentId);
    return content ? truncate(content, maxChars) : undefined;
  }

  private readAgentsMdFiles(
    globalPath: string | undefined,
    agentHome: string | undefined,
    maxChars: number
  ): string | undefined {
    if (!globalPath) return undefined;

    const parts: string[] = [];
    const seenContent = new Set<string>();

    const globalContent = readText(globalPath);
    if (globalContent) {
      parts.push(globalContent);
      seenContent.add(globalContent);
    }

    const agentMdPath = agentHome ? path.join(agentHome, 'AGENTS.md') : undefined;
    const agentContent = agentMdPath ? readText(agentMdPath) : undefined;
    if (agentContent && !seenContent.has(agentContent) && !isOnlyComments(agentContent)) {
      parts.push(`---\n\n<!-- Agent-level rules (${agentMdPath}) -->\n\n${agentContent}`);
    }

    if (parts.length === 0) return undefined;

    const pathLines = [`Global path: ${globalPath}`];
    if (agentMdPath) pathLines.push(`Agent path: ${agentMdPath}`);

    return truncate(
      `<system_agents_md>
This is the system-wide AGENTS.md protocol file. It contains identity, rules, and shared context
that ALL agents MUST follow. You may update the Agent-level copy in your Agent Home directory.

${pathLines.join('\n')}

${parts.join('\n\n')}
</system_agents_md>`,
      maxChars
    );
  }

  private readWorkspaceContextFiles(
    workspace: string | undefined,
    maxTotalChars: number,
    maxPerFileChars: number
  ): string | undefined {
    if (!workspace) return undefined;

    try {
      const entries = fs.readdirSync(workspace, { withFileTypes: true });
      const mdFiles = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map((entry) => entry.name)
        .sort();

      if (mdFiles.length === 0) return undefined;

      const sections: string[] = [];
      let totalLen = 0;

      for (const file of mdFiles) {
        if (totalLen >= maxTotalChars) break;
        const filePath = path.join(workspace, file);
        const content = readText(filePath);
        if (!content) continue;

        const section = `### ${file}\n\n${truncate(content, maxPerFileChars)}`;
        sections.push(section);
        totalLen += section.length;
      }

      if (sections.length === 0) return undefined;

      return truncate(
        `<workspace_context>
Session-persistent context files from the workspace root.
These were created in previous conversation turns and auto-loaded for continuity.
You may update or add new files in the workspace root to persist information across turns.

${sections.join('\n\n---\n\n')}
</workspace_context>`,
        maxTotalChars
      );
    } catch {
      return undefined;
    }
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

function truncate(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + '\n\n... (truncated)';
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
