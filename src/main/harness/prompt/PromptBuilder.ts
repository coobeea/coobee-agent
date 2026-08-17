import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { PromptPreamble, SharedSkillPromptLimit, SkipDirNames, SkillsXMLWrapper } from '../types/Constants';
import type { ConfigDoc, InstructionsAssembly, ToolkitSkillEntry } from '../config/ConfigLoader';
import { GLOBAL_SYSTEM_PROMPT, RUNTIME_ENVIRONMENT_TEMPLATE, SUBAGENT_GLOBAL_SYSTEM_PROMPT } from './templates';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export function buildGlobalSystemPrompt(): string {
  return GLOBAL_SYSTEM_PROMPT;
}

export function buildSubagentGlobalSystemPrompt(): string {
  return SUBAGENT_GLOBAL_SYSTEM_PROMPT;
}

export function buildSessionEnvironmentBlock(workspaceRoot: string, sessionRoot: string, agentRoot: string): string {
  if (!workspaceRoot.trim()) return '';
  const lines = [`workspace_root: ${toSlash(workspaceRoot)}`];
  if (sessionRoot.trim()) lines.push(`session_root: ${toSlash(sessionRoot)}`);
  if (agentRoot.trim()) lines.push(`agent_root: ${toSlash(agentRoot)}`);
  return `<session_environment>\n${lines.join('\n')}\n</session_environment>`;
}

export function buildSystemTimeBlock(now: Date = new Date()): string {
  const tz = process.env.TZ?.trim() || 'Asia/Shanghai';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short'
  }).formatToParts(now);

  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const time = `${get('hour')}:${get('minute')}:${get('second')}`;
  const weekday = `星期${WEEKDAYS[now.getDay()] ?? ''}`;
  return [
    '<system_time>',
    `date: ${date}`,
    `time: ${time}`,
    `weekday: ${weekday}`,
    `timezone: ${tz}`,
    `datetime: ${now.toISOString()}`,
    '</system_time>'
  ].join('\n');
}

export async function buildRuntimeEnvironmentPrompt(agentRoot: string): Promise<string> {
  let body = RUNTIME_ENVIRONMENT_TEMPLATE;
  if (!body) return '';
  if (agentRoot.trim()) {
    try {
      const entries = await readdir(agentRoot, { withFileTypes: true });
      const dirs = entries
        .filter((e) => e.isDirectory() && !SkipDirNames.has(e.name) && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort();
      if (dirs.length > 0) {
        const listing = dirs.map((d) => `- ${d}/`).join('\n');
        const anchor = '存放当前智能体的配置、规则文档、静态知识与技能包。';
        if (body.includes(anchor)) {
          body = body.replace(anchor, `${anchor}\n\n目录一览：\n${listing}`);
        }
      }
    } catch {
      // ignore
    }
  }
  return `<runtime_environment>\n${body}\n</runtime_environment>`;
}

export async function buildSharedSkillsPrompt(sharedSkillsRoot: string): Promise<string> {
  if (!sharedSkillsRoot.trim()) return '';
  const skills = await walkSkillMd(sharedSkillsRoot);
  if (skills.length === 0) return '';
  const seen = new Set<string>();
  const unique = skills.filter((s) => {
    const key = s.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.sort((a, b) => a.name.localeCompare(b.name));
  const limited = unique.slice(0, SharedSkillPromptLimit);
  const lines = limited.map((s) => {
    const desc = s.description.length > 160 ? `${s.description.slice(0, 160)}…` : s.description;
    return `- ${s.name}: ${desc} (${toSlash(s.path)})`;
  });
  return `<shared_skills>\n${lines.join('\n')}\n</shared_skills>`;
}

function buildSkillsBlock(entries: ToolkitSkillEntry[] | undefined, agentRoot: string): string {
  if (!entries?.length) return '';
  const lines: string[] = [];
  for (const e of entries) {
    if (e.enabled === false) continue;
    const name = e.name || e.key || path.basename(e.path || '');
    if (!name) continue;
    const p = e.path
      ? path.isAbsolute(e.path)
        ? e.path
        : path.join(agentRoot, e.path)
      : e.key
        ? path.join(agentRoot, '.agents', 'skills', e.key)
        : '';
    lines.push(`- ${name}: ${e.description ?? ''} (${toSlash(p)})`);
  }
  if (!lines.length) return '';
  return `<${SkillsXMLWrapper}>\n${PromptPreamble}\n${lines.join('\n')}\n</${SkillsXMLWrapper}>`;
}

function buildSubagentsBlock(cfg: ConfigDoc): string {
  const entries = cfg.toolkit?.subagents ?? [];
  if (!entries.length) return '';
  const lines = entries.filter((e) => e.enabled !== false).map((e) => `- ${e.key || e.name}: ${e.description ?? ''}`);
  if (!lines.length) return '';
  return `<subagents>\n${PromptPreamble}\nUse spawn_subagent to delegate.\n${lines.join('\n')}\n</subagents>`;
}

export async function assembleInstructions(
  base: string,
  doc: ConfigDoc,
  agentRoot: string,
  sharedSkillsRoot: string
): Promise<InstructionsAssembly> {
  const skills = buildSkillsBlock(doc.toolkit?.skills, agentRoot);
  const subagents = buildSubagentsBlock(doc);
  const shared = await buildSharedSkillsPrompt(sharedSkillsRoot);
  const runtime = await buildRuntimeEnvironmentPrompt(agentRoot);
  const global = buildGlobalSystemPrompt();

  const sections = [global, base, skills, subagents, shared, runtime].filter((s) => s.trim());
  const effective = sections.join('\n\n');
  return {
    effective,
    sources: {
      global,
      agent: base,
      skills,
      subagents,
      shared_skills: shared,
      runtime_environment: runtime
    }
  };
}

export class DefaultAssembler {
  assemble(base: string, doc: ConfigDoc, agentRoot: string, sharedSkillsRoot: string): Promise<InstructionsAssembly> {
    return assembleInstructions(base, doc, agentRoot, sharedSkillsRoot);
  }
}

export class DefaultBuilder {
  buildRuntimeInstructions(opts: {
    global?: string;
    agentSupplement?: string;
    skills?: string;
    subagents?: string;
    sharedSkills?: string;
    runtimeEnv?: string;
    injectedBlocks?: string[];
  }): string {
    return [
      opts.global ?? buildGlobalSystemPrompt(),
      opts.agentSupplement ?? '',
      opts.skills ?? '',
      opts.subagents ?? '',
      opts.sharedSkills ?? '',
      opts.runtimeEnv ?? '',
      ...(opts.injectedBlocks ?? [])
    ]
      .filter((s) => s.trim())
      .join('\n\n');
  }

  buildSubagentRuntimeInstructions(
    personaBody: string,
    opts?: {
      sharedSkills?: string;
      runtimeEnv?: string;
      injectedBlocks?: string[];
    }
  ): string {
    return [
      buildSubagentGlobalSystemPrompt(),
      personaBody,
      opts?.sharedSkills ?? '',
      opts?.runtimeEnv ?? '',
      ...(opts?.injectedBlocks ?? [])
    ]
      .filter((s) => s.trim())
      .join('\n\n');
  }
}

async function walkSkillMd(root: string): Promise<Array<{ name: string; description: string; path: string }>> {
  const out: Array<{ name: string; description: string; path: string }> = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 6) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'SKILL.md' && e.isFile()) {
        const full = path.join(dir, e.name);
        const meta = await parseSkillFrontmatter(full);
        out.push({ name: meta.name || path.basename(dir), description: meta.description, path: full });
        continue;
      }
      if (e.isDirectory() && !SkipDirNames.has(e.name)) {
        await walk(path.join(dir, e.name), depth + 1);
      }
    }
  }
  await walk(root, 0);
  return out;
}

async function parseSkillFrontmatter(file: string): Promise<{ name: string; description: string }> {
  try {
    const { readFile } = await import('node:fs/promises');
    const text = await readFile(file, 'utf8');
    if (!text.startsWith('---')) return { name: '', description: '' };
    const end = text.indexOf('\n---', 3);
    if (end < 0) return { name: '', description: '' };
    const fm = text.slice(3, end);
    const name =
      /(?:^|\n)name:\s*(.+)/
        .exec(fm)?.[1]
        ?.trim()
        .replace(/^["']|["']$/g, '') ?? '';
    const description =
      /(?:^|\n)description:\s*(.+)/
        .exec(fm)?.[1]
        ?.trim()
        .replace(/^["']|["']$/g, '') ?? '';
    return { name, description };
  } catch {
    return { name: '', description: '' };
  }
}

function toSlash(p: string): string {
  return p.replace(/\\/g, '/');
}
