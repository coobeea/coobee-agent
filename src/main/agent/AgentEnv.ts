/**
 * Agent 运行时环境 — 安全子集
 *
 * 从全局 Env 中提取 Agent 可见的路径和配置，
 * 不暴露数据库、端口、密钥等敏感信息。
 *
 * 用途：
 *   1. 注入到系统提示词（appendInstructions）的 <runtime_paths> 块
 *   2. 作为 Agent 进程的环境变量子集（未来 sandbox 场景）
 */

import type { AgentRuntimeLayout } from './context/AgentRuntimeLayout';

// ==================== 类型定义 ====================

/**
 * Agent 可见的运行时环境
 *
 * 让 AI 全面了解自身所处的环境，包括：
 *   - 系统信息（平台、架构、版本）
 *   - 目录结构（工作空间、Skill、Extension、记忆）
 *   - 能力清单（可用工具、已加载扩展）
 */
export interface AgentEnv {
  // --- Agent 身份 ---
  /** Agent 定义 ID */
  agentId: string;
  /** Agent 名称（未指定时默认为 agentId） */
  agentName: string;
  /** Agent Home 目录（{agentsDir}/{agentId}/，跨会话持久化空间） */
  agentHome: string;

  // --- 会话 ---
  /** 当前会话 ID */
  sessionId: string;
  /** 当前会话运行产物目录 */
  sessionDir: string;
  /** 记忆目录 */
  memoryDir: string;
  /** 会话目录 */
  sessionsDir: string;
  /** 技能目录 */
  skillsDir: string;

  // --- 系统信息 ---
  /** 操作系统 */
  platform: 'darwin' | 'win32' | 'linux';
  /** CPU 架构 */
  arch: string;
  /** 应用版本 */
  appVersion: string;

  // --- 目录与路径 ---
  /** Agent 业务项目目录，也是工具默认 cwd */
  projectDir: string;
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

// ==================== 构建函数 ====================

/**
 * 从 AgentRuntimeLayout 构建 Agent 安全环境子集
 *
 * @param layout Agent 运行时布局（包含 agentId、sessionId、agentHome、projectDir、sessionDir 等）
 * @param agentName Agent 名称（可选，未指定时默认为 agentId）
 */
export async function buildAgentEnv(layout: AgentRuntimeLayout, agentName?: string): Promise<AgentEnv> {
  const { agentId, sessionId, agentHome, projectDir, sessionDir, memoryDir, sessionsDir, skillsDir } = layout;
  const resolvedAgentName = agentName ?? agentId;

  // 延迟导入 Env，避免测试环境循环依赖
  const { Env } = await import('@main/common/env');
  const { SkillManager } = await import('./skills');

  const skillPathSources = await SkillManager.buildDefaultSearchPathSources({ workspace: projectDir, agentHome });
  const skillPaths = SkillManager.searchPathsFromSources(skillPathSources);
  const extensionPaths = await Env.getExtensionSearchPaths(projectDir);

  // Extension 系统信息
  let loadedExtensions: string[] = [];
  let availableTools: string[] = [];

  try {
    const { ExtensionManager } = await import('@main/extension');
    const registry = ExtensionManager.getRegistry();
    if (registry) {
      // 已加载的 Extension ID 列表
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
    // Agent 身份
    agentId,
    agentName: resolvedAgentName,
    agentHome,

    // 会话
    sessionId,
    sessionDir,
    memoryDir,
    sessionsDir,
    skillsDir,

    // 系统信息
    platform: process.platform as 'darwin' | 'win32' | 'linux',
    arch: process.arch,
    appVersion: Env.app?.version ?? '0.0.0',

    // 目录与路径
    projectDir,
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
