import path from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import type { ExecContext } from '../definition/Tool';
import type { StreamUpdate, ToolResult } from '../../types/ToolTypes';
import {
  AgentSearchRelDirs,
  EntryFileName,
  FindDefaultLimit,
  FindMaxLimit,
  SharedSkillsRootDefault,
  SharedSkillsRootEnv,
  SkillMDGlob,
  SkipDirNames
} from '../../types/Constants';
import { ToolCategoryDiscovery, ToolName } from '../../types/ToolTypes';
import { createHandlerTool, type HandlerTool } from './HandlerTool';
import { skillFindParamsSchema } from './schemas';
import { SkillFindToolDescription } from './descriptions';
import { formatError, optionalInt, strParam, successResult } from './helpers';
import { commandExists, runCommand } from './io';

type SkillSource = 'agent' | 'shared';
type FindScope = 'shared' | 'agent' | 'all';
type FindAction = 'list' | 'search';

interface SearchRoot {
  kind: SkillSource;
  relPath: string;
  absolutePath: string;
}

interface SkillEntry {
  kind: SkillSource;
  name: string;
  description: string;
  valid: boolean;
  filePath: string;
  configPath?: string;
}

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/;

function parseFrontmatter(content: string): { name: string; description: string } {
  const raw = content
    .trim()
    .replace(/^\ufeff/, '')
    .replace(/\r\n/g, '\n');
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return { name: '', description: '' };
  const body = match[1]!;
  let name = '';
  let description = '';
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed
      .slice(idx + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (key === 'name' && val) name = val;
    if (key === 'description' && val) description = val;
  }
  return { name, description };
}

async function parseFrontmatterFile(filePath: string): Promise<{ name: string; description: string }> {
  try {
    const data = await readFile(filePath, 'utf8');
    return parseFrontmatter(data);
  } catch {
    return { name: '', description: '' };
  }
}

function resolveSkillFindScope(raw: string): { scope: FindScope; note: string } {
  const s = raw.trim().toLowerCase();
  if (!s) return { scope: 'shared', note: '' };
  if (s === 'shared' || s === 'agent' || s === 'all') return { scope: s, note: '' };
  return {
    scope: 'shared',
    note: `Note: scope=${JSON.stringify(raw)} is invalid; only shared | agent | all are allowed. Applied scope=shared (default) for this call.`
  };
}

function clampLimit(raw?: number): number {
  let n = FindDefaultLimit;
  if (raw && raw > 0) n = raw;
  return Math.min(n, FindMaxLimit);
}

function clampOffset(raw?: number): number {
  if (raw == null || raw < 0) return 0;
  return raw;
}

async function listExistingRoots(agentRoot: string, sharedRoot: string): Promise<SearchRoot[]> {
  const roots: SearchRoot[] = [];
  for (const rel of AgentSearchRelDirs) {
    const abs = path.join(agentRoot, rel);
    try {
      const info = await stat(abs);
      if (info.isDirectory()) {
        roots.push({ kind: 'agent', relPath: rel, absolutePath: abs });
      }
    } catch {
      /* skip */
    }
  }
  try {
    const info = await stat(sharedRoot);
    if (info.isDirectory()) {
      roots.push({ kind: 'shared', relPath: '.', absolutePath: sharedRoot });
    }
  } catch {
    /* skip */
  }
  return roots;
}

async function walkSkillMdInRoot(dir: string, root: SearchRoot, agentRoot: string): Promise<SkillEntry[]> {
  const found: SkillEntry[] = [];

  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (full !== dir && SkipDirNames.has(entry.name)) continue;
        await walk(full);
        continue;
      }
      if (entry.name !== EntryFileName) continue;
      const relDir = path.relative(root.absolutePath, path.dirname(full));
      if (!relDir || relDir === '.') continue;
      const { name, description } = await parseFrontmatterFile(full);
      const item: SkillEntry = {
        kind: root.kind,
        name: name || path.basename(relDir),
        description,
        valid: Boolean(name && description),
        filePath: path.normalize(full)
      };
      if (root.kind === 'agent') {
        const relToAgent = path.relative(agentRoot, path.dirname(full));
        if (relToAgent && relToAgent !== '.') {
          item.configPath = relToAgent.split(path.sep).join('/');
        }
      }
      found.push(item);
    }
  }

  await walk(dir);
  return found;
}

async function discoverEntries(roots: SearchRoot[], agentRoot: string): Promise<SkillEntry[]> {
  const found: SkillEntry[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    const batch = await walkSkillMdInRoot(root.absolutePath, root, agentRoot);
    for (const e of batch) {
      if (seen.has(e.filePath)) continue;
      seen.add(e.filePath);
      found.push(e);
    }
  }
  found.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'agent' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return found;
}

async function ripgrepSkillPaths(keyword: string, roots: SearchRoot[]): Promise<Set<string>> {
  const rgBin = process.env.VESSEL_RG_BIN?.trim() || 'rg';
  if (!(await commandExists(rgBin))) {
    throw new Error(`ripgrep (${rgBin}) is not available`);
  }
  const args = ['--color', 'never', '-i', '-F', '-l', '--glob', SkillMDGlob, '--', keyword];
  for (const r of roots) args.push(r.absolutePath);
  const res = await runCommand('', rgBin, args);
  if (res.exitCode === 2) {
    throw new Error(res.stderr.trim() || 'ripgrep failed');
  }
  const out = new Set<string>();
  for (const line of res.stdout.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) out.add(path.normalize(trimmed));
  }
  return out;
}

function formatEntryBlock(e: SkillEntry): string {
  const tag = e.kind === 'shared' ? ' [shared]' : ' [agent]';
  const validSuffix = e.valid ? '' : ' _(SKILL.md invalid)_';
  const lines = [`- **${e.name}**${tag}${validSuffix}`];
  if (e.description) lines.push(`  Description: ${e.description}`);
  lines.push(`  Path: ${e.filePath}`);
  if (e.kind === 'shared') lines.push('  enabled_in_config: (shared)');
  else if (e.configPath) lines.push('  enabled_in_config: (not registered in config.yaml)');
  return lines.join('\n');
}

function formatResponse(
  action: FindAction,
  scope: FindScope,
  scopeNote: string,
  keyword: string,
  limit: number,
  offset: number,
  total: number,
  matched: number,
  page: SkillEntry[]
): string {
  const returned = page.length;
  const showingFrom = matched > 0 ? offset + 1 : 0;
  const showingTo = matched > 0 ? offset + returned : 0;
  let header = `Skill find (action=${action}, scope=${scope}, limit=${limit}, offset=${offset})`;
  if (action === 'search' && keyword) header += `, keyword=${JSON.stringify(keyword)}`;
  const lines = [
    header,
    `Total: ${total} | Matched: ${matched} | Showing: ${showingFrom}-${showingTo} of ${matched} (returned ${returned})`,
    ''
  ];
  if (scopeNote) lines.push(scopeNote, '');
  if (matched === 0) {
    lines.push(
      action === 'search'
        ? 'No Skills matched the keyword in configured search roots.'
        : 'No SKILL.md files found in configured search roots.'
    );
  } else if (offset >= matched) {
    lines.push(`offset ${offset} is beyond matched count (${matched}).`);
  } else if (returned === 0) {
    lines.push('No entries in this page.');
  } else {
    for (const e of page) {
      lines.push(formatEntryBlock(e), '');
    }
  }
  if (matched > 0 && offset + returned < matched) {
    lines.push(`— Use offset=${offset + returned} to see more (${matched - offset - returned} remaining).`);
  }
  lines.push(
    'Use read with the absolute SKILL.md Path above. Agent toolkit skills are in system <skills>; platform partial index is in <shared_skills>. Prefer scope=shared (default) for more platform skills.'
  );
  return lines.join('\n').trimEnd();
}

async function skillFindHandler(
  ctx: ExecContext,
  params: Record<string, unknown>,
  _onUpdate?: (update: StreamUpdate) => void
): Promise<ToolResult> {
  const actionRaw = strParam(params, 'action') || 'list';
  const action: FindAction = actionRaw === 'search' ? 'search' : 'list';
  const { scope, note: scopeNote } = resolveSkillFindScope(strParam(params, 'scope'));
  const keyword = strParam(params, 'keyword').trim();
  const limit = clampLimit(optionalInt(params, 'limit'));
  const offset = clampOffset(optionalInt(params, 'offset'));

  if (action === 'search' && !keyword) {
    return formatError('MISSING_PARAM', 'keyword is required when action=search');
  }

  const agentRoot = ctx.agentRoot;
  if (!agentRoot) return formatError('NO_AGENT_ROOT', 'agent root is not available');

  let sharedRoot = ctx.sharedSkillsRoot?.trim() || process.env[SharedSkillsRootEnv]?.trim() || '';
  if (!sharedRoot) sharedRoot = SharedSkillsRootDefault;

  let roots = await listExistingRoots(agentRoot, sharedRoot);
  if (scope !== 'all') {
    const want: SkillSource = scope === 'agent' ? 'agent' : 'shared';
    roots = roots.filter((r) => r.kind === want);
  }

  const all = await discoverEntries(roots, agentRoot);
  let matched = all;
  if (action === 'search') {
    try {
      const paths = await ripgrepSkillPaths(keyword, roots);
      matched = all.filter((e) => paths.has(e.filePath));
    } catch (err) {
      return formatError('SKILL_FIND_ERROR', err instanceof Error ? err.message : String(err));
    }
  }

  const page = matched.slice(offset, offset + limit);
  return successResult(
    formatResponse(action, scope, scopeNote, keyword, limit, offset, all.length, matched.length, page)
  );
}

export function createSkillFindTool(): HandlerTool {
  return createHandlerTool(ToolName.SkillFind, SkillFindToolDescription, ToolCategoryDiscovery, skillFindHandler, {
    parametersSchema: skillFindParamsSchema
  });
}
