/**
 * Agent 运行时环境 — 安全子集
 *
 * 从全局 Env 中提取 Agent 可见的路径和配置，
 * 不暴露数据库、端口、密钥等敏感信息。
 *
 * 用途：
 *   1. 注入到系统提示词（appendInstructions）的 <runtime_paths> 块
 *   2. 作为 Agent 进程的环境变量子集（未来 sandbox 场景）
 *
 * 本文件同时包含：
 *   - AgentRuntimeLayout 接口定义（路径布局）
 *   - computeAgentLayoutPaths 路径计算（单一来源）
 *   - computeAgentRuntimeLayout 便捷函数（自动从 Env 取 agentsDir）
 *   - ensureAgentRuntimeLayout / ensureAgentRuntimeLayoutSync（mkdir）
 *   - resolveThreadRuntimeLayoutSync（从 thread 反推布局）
 *   - buildAgentEnv 完整环境构建
 */

import fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import path from 'node:path';

import { Env } from '@main/common/env';

// ==================== 类型定义 ====================

/**
 * Agent 运行时布局 — 路径集合
 *
 * 描述 Agent 运行时所需的目录结构，所有路径由 computeAgentLayoutPaths 统一计算。
 */
export interface AgentRuntimeLayout {
  /** Agent 定义 ID */
  agentId: string;
  /** 会话 ID */
  sessionId: string;
  /** Agent Home 目录（{agentsDir}/{agentId}） */
  agentHome: string;
  /** Agent 项目目录（{agentHome}/project），工具默认 cwd */
  projectDir: string;
  /** 记忆目录（{agentHome}/memory） */
  memoryDir: string;
  /** 会话目录（{agentHome}/sessions） */
  sessionsDir: string;
  /** 当前会话产物目录（{agentHome}/sessions/{sessionId}） */
  sessionDir: string;
  /** 技能目录（{agentHome}/skills） */
  skillsDir: string;
}

/**
 * Agent 可见的运行时环境
 *
 * 让 AI 全面了解自身所处的环境，包括：
 *   - 系统信息（平台、架构、版本）
 *   - 目录结构（工作空间、Skill、Extension、记忆）
 *   - 能力清单（可用工具、已加载扩展）
 *
 * 路径字段通过 extends AgentRuntimeLayout 继承，
 * 保证与布局层的字段定义始终一致。
 */
export interface AgentEnv extends AgentRuntimeLayout {
  // --- Agent 身份（扩展） ---
  /** Agent 名称（未指定时默认为 agentId） */
  agentName: string;

  // --- 系统信息 ---
  /** 操作系统 */
  platform: 'darwin' | 'win32' | 'linux';
  /** CPU 架构 */
  arch: string;
  /** 应用版本 */
  appVersion: string;

  // --- 目录与路径（扩展） ---
  /** 用户主目录（应用级，如 ~/.coobee-ai） */
  userHome: string;
  /** 系统用户主目录（如 /Users/xxx） */
  systemHome: string;
  /** 系统临时目录 */
  tempDir: string;
  /** 配置目录（存放 coobee.json5、secrets.json5、skills.json5） */
  configDir: string;
  /** 会话线程目录（{userHome}/threads/，Snowflake ID 有序） */
  threadsDir: string;
  /**
   * 用户 Agent 集中存储目录（可读写），所有用户创建/导入的 Agent 均存放在此。
   *
   * 每个 Agent 以 agentId 为子目录名形成 Agent Home：`{agentsDir}/{agentId}/`
   *
   * 实际路径：
   *   - 开发环境：`<项目>/.home/agents/`
   *   - 生产环境：`~/.coobee-ai/agents/`
   *
   * 与 builtinAgentsDir（只读）不同，此为可读写目录。
   *
   * 典型结构：
   *   agents/
   *   ├── agent-crs-reporter/    ← Agent Home
   *   │   ├── IDENTITY.md
   *   │   ├── SOUL.md
   *   │   ├── skills/            ← Agent 专属技能
   *   │   ├── project/           ← 工具执行的 cwd
   *   │   └── sessions/          ← 该 Agent 下的会话产物
   *   └── ...
   */
  agentsDir: string;

  // --- Skill 系统 ---
  /** Skill 搜索路径（按优先级从低到高） */
  skillPaths: string[];
  /** Skill 搜索路径来源（按优先级从低到高） */
  skillPathSources: import('./skills').SkillSearchPathSource[];

  // --- Extension 系统 ---
  /** Extension 搜索路径（按优先级从低到高） */
  extensionPaths: string[];
  /** 内置 Extension 目录 */
  builtinExtensionsDir: string;
  /** 用户 Extension 目录 */
  userExtensionsDir: string;
  /** 已加载的 Extension ID 列表 */
  loadedExtensions: string[];

  // --- 能力清单 ---
  /** 可用工具名称列表 */
  availableTools: string[];

  // --- 安全上下文 ---
  /** 沙箱模式 */
  sandboxMode: 'off' | 'path-only' | 'docker';
  /** 命令审批策略 */
  execApproval: 'auto' | 'always' | 'never';

  // --- 模型上下文 ---
  /** 当前默认模型（provider/model 格式） */
  defaultModel: string;
  /** 思维链级别 */
  thinkingLevel: string;
}

// ==================== 路径计算（单一来源） ====================

/**
 * 从 agentsDir + agentId + sessionId 计算运行时布局路径（纯计算，无副作用）
 *
 * 这是路径计算的唯一入口，所有需要布局路径的地方均委托此函数，
 * 保证路径结构只维护一处。
 */
export function computeAgentLayoutPaths(agentsDir: string, agentId: string, sessionId: string): AgentRuntimeLayout {
  if (!agentId || !agentId.trim()) {
    throw new Error('[AgentEnv] agentId is required');
  }
  if (!sessionId || !sessionId.trim()) {
    throw new Error('[AgentEnv] sessionId is required');
  }

  const agentHome = path.join(agentsDir, agentId);
  const projectDir = path.join(agentHome, 'project');
  const memoryDir = path.join(agentHome, 'memory');
  const sessionsDir = path.join(agentHome, 'sessions');
  const sessionDir = path.join(sessionsDir, sessionId);
  const skillsDir = path.join(agentHome, 'skills');

  return {
    agentId,
    sessionId,
    agentHome,
    projectDir,
    memoryDir,
    sessionsDir,
    sessionDir,
    skillsDir
  };
}

/**
 * 从 agentId + sessionId 计算运行时布局路径（自动从 Env 取 agentsDir）
 *
 * 供不需要完整 AgentEnv 的场景使用（如 mkdir、thread 解析）。
 */
export function computeAgentRuntimeLayout(options: { agentId: string; sessionId: string }): AgentRuntimeLayout {
  return computeAgentLayoutPaths(Env.paths.agentsDir, options.agentId, options.sessionId);
}

// ==================== 目录创建 ====================

/**
 * 确保运行时目录存在（异步）
 *
 * 接收 AgentRuntimeLayout（由 computeAgentRuntimeLayout 或 AgentEnv 提供），
 * 只负责创建目录，不做路径计算。
 */
export async function ensureAgentRuntimeLayout(layout: AgentRuntimeLayout): Promise<AgentRuntimeLayout> {
  await Promise.all([
    fsp.mkdir(layout.agentHome, { recursive: true }),
    fsp.mkdir(layout.projectDir, { recursive: true }),
    fsp.mkdir(layout.memoryDir, { recursive: true }),
    fsp.mkdir(layout.sessionsDir, { recursive: true }),
    fsp.mkdir(layout.sessionDir, { recursive: true }),
    fsp.mkdir(layout.skillsDir, { recursive: true })
  ]);
  return layout;
}

/**
 * 确保运行时目录存在（同步）
 */
export function ensureAgentRuntimeLayoutSync(layout: AgentRuntimeLayout): AgentRuntimeLayout {
  fs.mkdirSync(layout.agentHome, { recursive: true });
  fs.mkdirSync(layout.projectDir, { recursive: true });
  fs.mkdirSync(layout.memoryDir, { recursive: true });
  fs.mkdirSync(layout.sessionsDir, { recursive: true });
  fs.mkdirSync(layout.sessionDir, { recursive: true });
  fs.mkdirSync(layout.skillsDir, { recursive: true });
  return layout;
}

/**
 * 从 thread ID 解析运行时布局并创建目录（同步）
 *
 * 供 HistoryWriter/EventWriter 等需要从 sessionId 反推路径的场景使用。
 */
export function resolveThreadRuntimeLayoutSync(sessionId: string, fallbackAgentId?: string): AgentRuntimeLayout {
  const thread = readThreadDefinitionSync(sessionId);
  const agentId = typeof thread?.agentId === 'string' && thread.agentId ? thread.agentId : fallbackAgentId;

  if (!agentId) {
    throw new Error(`[AgentEnv] Cannot resolve agentId for session ${sessionId}`);
  }

  const layout = computeAgentRuntimeLayout({ agentId, sessionId });
  return ensureAgentRuntimeLayoutSync(layout);
}

function readThreadDefinitionSync(sessionId: string): Record<string, unknown> | null {
  const filePath = path.join(Env.paths.threadsDir, `${sessionId}.json`);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

// ==================== 构建函数 ====================

/** buildAgentEnv 的参数 */
export interface BuildAgentEnvOptions {
  /** Agent 定义 ID */
  agentId: string;
  /** 会话 ID */
  sessionId: string;
  /** Agent 名称（可选，未指定时默认为 agentId） */
  agentName?: string;
}

/**
 * 构建 Agent 安全环境子集
 *
 * 路径计算在此函数内部完成（agentHome/projectDir/sessionDir 等），
 * 不再依赖外部传入的 AgentRuntimeLayout。
 *
 * @param options 包含 agentId、sessionId、agentName
 */
export async function buildAgentEnv(options: BuildAgentEnvOptions): Promise<AgentEnv> {
  const { agentId, sessionId, agentName } = options;
  const resolvedAgentName = agentName ?? agentId;

  // 延迟导入 Env，避免测试环境循环依赖
  const { Env } = await import('@main/common/env');

  // ---- 路径计算（单一来源：computeAgentLayoutPaths） ----
  const layout = computeAgentLayoutPaths(Env.paths.agentsDir, agentId, sessionId);

  // ---- Skill / Extension 路径聚合 ----
  const { SkillManager } = await import('./skills');

  const skillPathSources = await SkillManager.buildDefaultSearchPathSources({
    workspace: layout.projectDir,
    agentHome: layout.agentHome
  });
  const skillPaths = SkillManager.searchPathsFromSources(skillPathSources);
  const extensionPaths = await Env.getExtensionSearchPaths(layout.projectDir);

  // Extension 系统信息
  let loadedExtensions: string[] = [];
  let availableTools: string[] = [];

  try {
    const { ExtensionManager } = await import('@main/extension');
    const registry = ExtensionManager.getRegistry();
    if (registry) {
      loadedExtensions = registry.getExtensionIds();
    }
  } catch {
    // Extension 系统未初始化时忽略
  }

  // 可用工具清单
  try {
    const { ToolRegistry } = await import('@main/agent/tools/registry');
    const toolReg = ToolRegistry.getInstance();
    availableTools = toolReg.getAll().map((t) => t.name);
  } catch {
    // ToolRegistry 未初始化时忽略
  }

  // 安全与模型上下文
  let sandboxMode: 'off' | 'path-only' | 'docker' = 'path-only';
  let execApproval: 'auto' | 'always' | 'never' = 'auto';
  let defaultModel = 'unknown';
  let thinkingLevel = 'medium';

  try {
    const { configStoreInstance } = await import('@main/common/config/ConfigStore');
    if (configStoreInstance) {
      const security = configStoreInstance.get('security');
      sandboxMode = security?.sandbox?.mode ?? 'path-only';
      execApproval = security?.approvals?.exec ?? 'auto';

      const models = configStoreInstance.get('models');
      defaultModel = models?.defaults?.model?.primary ?? 'unknown';
      thinkingLevel = models?.defaults?.thinkingLevel ?? 'medium';
    }
  } catch {
    // ConfigStore 未初始化时使用默认值
  }

  return {
    // 布局字段（来自 AgentRuntimeLayout，通过 extends 继承）
    ...layout,

    // Agent 身份（扩展）
    agentName: resolvedAgentName,

    // 系统信息
    platform: process.platform as 'darwin' | 'win32' | 'linux',
    arch: process.arch,
    appVersion: Env.app?.version ?? '0.0.0',

    // 目录与路径（扩展）
    userHome: Env.paths.userHome,
    systemHome: Env.paths.home,
    tempDir: Env.paths.temp,
    configDir: Env.paths.configDir,
    threadsDir: Env.paths.threadsDir,
    agentsDir: Env.paths.agentsDir,

    // Skill 系统
    skillPaths,
    skillPathSources,

    // Extension 系统
    extensionPaths,
    builtinExtensionsDir: Env.paths.builtinExtensionsDir,
    userExtensionsDir: Env.paths.userExtensionsDir,
    loadedExtensions,

    // 能力清单
    availableTools,

    // 安全上下文
    sandboxMode,
    execApproval,

    // 模型上下文
    defaultModel,
    thinkingLevel
  };
}
