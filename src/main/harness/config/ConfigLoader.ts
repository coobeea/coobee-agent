import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { PolicyDefaults } from '../types/PolicyDefaults';
import { SharedSkillsRootDefault, SharedSkillsRootEnv } from '../types/Constants';

export const ConfigFileName = 'config.yaml';

export interface GenerationDefaults {
  temperature?: number;
  top_p?: number;
  thinking_level?: string;
}

export interface LLMBlock {
  default_model?: string;
  default_provider?: string;
  generation_defaults?: GenerationDefaults;
}

export interface ToolkitSkillEntry {
  path?: string;
  key?: string;
  name?: string;
  description?: string;
  type?: string;
  source?: string;
  enabled?: boolean;
}

export interface ToolkitSubagentEntry {
  key?: string;
  name?: string;
  path?: string;
  description?: string;
  enabled?: boolean;
}

export interface ToolkitBlock {
  skills?: ToolkitSkillEntry[];
  subagents?: ToolkitSubagentEntry[];
}

export interface AgentBlock {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  greeting?: string;
  quick_prompts?: Array<string | { label?: string; message?: string }>;
  subagent_enabled?: boolean;
  subagent_flash_optimization?: boolean;
  subagent_model?: string;
  sys_prompt_files?: string[];
  privacy_enabled?: boolean;
  firewall_enabled?: boolean;
}

export interface CompactionBlock {
  threshold_ratio?: number;
  keep_ratio?: number;
  min_messages?: number;
  debug?: boolean;
  context_window?: number;
}

export interface OrchestrationBlock {
  mode?: string;
  host_key?: string;
  members?: Array<Record<string, unknown>>;
  completion_checklist?: string[];
}

export interface ConfigDoc {
  agent?: AgentBlock;
  toolkit?: ToolkitBlock;
  llm?: LLMBlock;
  compaction?: CompactionBlock;
  runtime?: Record<string, unknown>;
  security?: { enforcement?: Record<string, unknown> };
  orchestration?: OrchestrationBlock;
  welcome_message?: string;
  completion_checklist?: string[];
}

export interface LoadedConfig {
  doc: ConfigDoc;
  subagentEnabled: boolean;
  found: boolean;
}

export interface SubagentModelPolicy {
  subagentModel: string;
  subagentFlashOptimization: boolean;
}

export interface InstructionsAssembly {
  effective: string;
  sources: Record<string, string>;
}

export interface InstructionsAssembler {
  assemble(
    base: string,
    cfg: ConfigDoc,
    agentRoot: string,
    sharedSkillsRoot: string
  ): Promise<InstructionsAssembly> | InstructionsAssembly;
}

export interface ConfigAgentProfile {
  agentId: string;
  name: string;
  defaultModel: string;
  defaultProvider: string;
  instructionAssembly: InstructionsAssembly;
}

function onOrDefault(v: boolean | undefined, fallback = true): boolean {
  return v === undefined || v === null ? fallback : v;
}

function normalizeSkillEntry(raw: unknown): ToolkitSkillEntry {
  if (typeof raw === 'string') {
    return { path: raw };
  }
  return (raw ?? {}) as ToolkitSkillEntry;
}

function normalizeConfig(raw: Record<string, unknown>): ConfigDoc {
  const toolkit = (raw.toolkit ?? {}) as Record<string, unknown>;
  const skills = Array.isArray(toolkit.skills) ? toolkit.skills.map(normalizeSkillEntry) : undefined;
  return {
    ...(raw as ConfigDoc),
    toolkit: {
      ...(toolkit as ToolkitBlock),
      skills
    }
  };
}

/** 加载 agentRoot/config.yaml；缺失不算错误。 */
export async function loadConfig(agentRoot: string): Promise<LoadedConfig> {
  if (!agentRoot.trim()) {
    return { doc: {}, subagentEnabled: true, found: false };
  }
  const file = path.join(agentRoot, ConfigFileName);
  try {
    const text = await readFile(file, 'utf8');
    const parsed = (parseYaml(text) ?? {}) as Record<string, unknown>;
    const doc = normalizeConfig(parsed);
    return {
      doc,
      found: true,
      subagentEnabled: onOrDefault(doc.agent?.subagent_enabled, true)
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return { doc: {}, subagentEnabled: true, found: false };
    }
    throw err;
  }
}

export async function loadPolicyFlags(agentRoot: string): Promise<PolicyDefaults> {
  if (!agentRoot.trim()) {
    return { privacy: false, firewall: false };
  }
  const loaded = await loadConfig(agentRoot);
  if (!loaded.found) {
    return { privacy: true, firewall: true };
  }
  return {
    privacy: onOrDefault(loaded.doc.agent?.privacy_enabled, true),
    firewall: onOrDefault(loaded.doc.agent?.firewall_enabled, true)
  };
}

export async function loadSubagentModelPolicy(agentRoot: string): Promise<SubagentModelPolicy> {
  const loaded = await loadConfig(agentRoot);
  if (!loaded.found) {
    return { subagentModel: '', subagentFlashOptimization: true };
  }
  return {
    subagentModel: loaded.doc.agent?.subagent_model?.trim() ?? '',
    subagentFlashOptimization: onOrDefault(loaded.doc.agent?.subagent_flash_optimization, true)
  };
}

export function resolveSharedSkillsRoot(explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  const fromEnv = process.env[SharedSkillsRootEnv]?.trim();
  if (fromEnv) return fromEnv;
  return SharedSkillsRootDefault;
}

export async function readSysPromptFiles(agentRoot: string, files: string[]): Promise<string> {
  const parts: string[] = [];
  for (const rel of files) {
    const abs = path.isAbsolute(rel) ? rel : path.join(agentRoot, rel);
    try {
      const content = await readFile(abs, 'utf8');
      const name = path.basename(rel);
      parts.push(`<${name}>\n${content.trim()}\n</${name}>`);
    } catch {
      // skip missing
    }
  }
  return parts.join('\n\n');
}

export async function loadAgentProfile(
  agentRoot: string,
  agentId: string,
  sharedSkillsRoot: string,
  assembler: InstructionsAssembler
): Promise<ConfigAgentProfile> {
  const loaded = await loadConfig(agentRoot);
  if (!loaded.found) {
    const base = process.env.VESSEL_AGENT_INSTRUCTIONS?.trim() ?? '';
    const assembly = await assembler.assemble(base, {}, agentRoot, sharedSkillsRoot);
    return {
      agentId,
      name: 'agent',
      defaultModel: process.env.OPENAI_MODEL?.trim() ?? '',
      defaultProvider: '',
      instructionAssembly: assembly
    };
  }

  const agent = loaded.doc.agent ?? {};
  const llm = loaded.doc.llm ?? {};
  let base = '';
  if (agent.sys_prompt_files?.length) {
    base = await readSysPromptFiles(agentRoot, agent.sys_prompt_files);
  } else {
    try {
      base = (await readFile(path.join(agentRoot, 'AGENTS.md'), 'utf8')).trim();
    } catch {
      base = '';
    }
  }

  const assembly = await assembler.assemble(base, loaded.doc, agentRoot, sharedSkillsRoot);
  return {
    agentId: agent.id?.trim() || agentId,
    name: agent.name?.trim() || 'agent',
    defaultModel: llm.default_model?.trim() || process.env.OPENAI_MODEL?.trim() || '',
    defaultProvider: llm.default_provider?.trim() || '',
    instructionAssembly: assembly
  };
}

export function resolveGenerationSettings(opts: {
  configDefaults?: GenerationDefaults;
  harnessDefaults?: { temperature?: number; thinkingLevel?: string };
  runOverrides?: { temperature?: number; thinkingLevel?: string };
}): { thinkingLevel: string; temperature?: number } {
  const thinking =
    opts.runOverrides?.thinkingLevel?.trim() ||
    opts.configDefaults?.thinking_level?.trim() ||
    opts.harnessDefaults?.thinkingLevel?.trim() ||
    'off';
  const temperature =
    opts.runOverrides?.temperature ?? opts.configDefaults?.temperature ?? opts.harnessDefaults?.temperature;
  return { thinkingLevel: thinking, temperature };
}

export async function loadToolkitSubagentRefs(agentRoot: string): Promise<ToolkitSubagentEntry[]> {
  const loaded = await loadConfig(agentRoot);
  return loaded.doc.toolkit?.subagents ?? [];
}
