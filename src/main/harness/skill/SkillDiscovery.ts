import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { AgentSearchRelDirs, EntryFileName, SkipDirNames } from '../types/Constants';

export interface SkillMeta {
  name: string;
  description: string;
  path: string;
  root: string;
}

export async function parseSkillFrontmatter(file: string): Promise<{ name: string; description: string }> {
  try {
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

export async function discoverSkills(roots: string[]): Promise<SkillMeta[]> {
  const out: SkillMeta[] = [];
  for (const root of roots) {
    if (!root.trim()) continue;
    await walk(root, root, 0, out);
  }
  return out;
}

export function agentSkillRoots(agentRoot: string): string[] {
  return AgentSearchRelDirs.map((rel) => path.join(agentRoot, rel));
}

async function walk(root: string, dir: string, depth: number, out: SkillMeta[]): Promise<void> {
  if (depth > 8) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === EntryFileName && e.isFile()) {
      const full = path.join(dir, e.name);
      const meta = await parseSkillFrontmatter(full);
      out.push({
        name: meta.name || path.basename(dir),
        description: meta.description,
        path: full,
        root
      });
      continue;
    }
    if (e.isDirectory() && !SkipDirNames.has(e.name)) {
      await walk(root, path.join(dir, e.name), depth + 1, out);
    }
  }
}
