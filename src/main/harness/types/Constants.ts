/** harness 侧生产缺省路径对照。 */
export const PathDefaults = {
  AgentRoot: '/var/vessel/agent',
  WorkspaceRoot: '/workspace',
  SessionRoot: '/var/vessel/session',
  EnvRoot: '/var/vessel/env',
  EnvOverrides: '/var/vessel/env/.overrides',
  EnvOverridesWork: '/var/vessel/env/.overrides-work',
  AgentEnvRoot: '/var/vessel/agent-env',
  HostAgentRoot: '/root/.agent',
  OverlayLocalRoot: '/var/vessel/overlay-local',
  RuntimeLogDir: '/var/vessel/runtime/logs',
  PlatformSkillsRoot: '/var/vessel/skills'
} as const;

/** 工具路径黑名单根（目录及其子路径禁止）。 */
export const PathBlacklist: readonly string[] = [
  PathDefaults.HostAgentRoot,
  PathDefaults.SessionRoot,
  PathDefaults.EnvOverrides,
  PathDefaults.EnvOverridesWork,
  PathDefaults.OverlayLocalRoot,
  PathDefaults.RuntimeLogDir
];

export const PathBlacklistSegment = '.overrides';

export const SharedSkillsRootDefault = '/var/vessel/skills';
export const SharedSkillsRootEnv = 'VESSEL_PLATFORM_SKILLS_ROOT';
export const EntryFileName = 'SKILL.md';
export const SkillMDGlob = '**/SKILL.md';
export const MinFrontmatterSchemaVersion = 1;

export const SkipDirNames = new Set([
  '.git',
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
  'dist',
  'build',
  '.overrides'
]);

export const AgentSearchRelDirs: readonly string[] = [
  'skills',
  '.agents/skills',
  '.claude/skills',
  '.cursor/skills',
  '.qoder/skills',
  '.trae/skills'
];

export const EcosystemSkillRootPrefixes: readonly string[] = [
  'skills/',
  '.agents/skills/',
  '.claude/skills/',
  '.cursor/skills/',
  '.qoder/skills/',
  '.trae/skills/'
];

export const FindDefaultLimit = 10;
export const FindMaxLimit = 20;

export const PromptPreamble =
  'Before using a skill, use the read tool on the Path below to load the full SKILL.md. Only names and descriptions are listed here; do not paste raw SKILL.md body to the user.';

export const SkillsXMLWrapper = 'skills';
export const SharedSkillPromptLimit = 5;

/** 标准 Agent Run 事件的默认进程内 topic。 */
export const RunEventTopic = 'vessel:agent:run:event';
