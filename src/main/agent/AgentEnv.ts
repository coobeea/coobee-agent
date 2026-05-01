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
  // --- 系统信息 ---
  /** 操作系统 */
  platform: 'darwin' | 'win32' | 'linux';
  /** CPU 架构 */
  arch: string;
  /** 应用版本 */
  appVersion: string;

  // --- 项目目录 ---
  /** Agent 业务项目目录，也是工具默认 cwd */
  project: string;
  /** 当前会话 ID */
  sessionId: string;

  // --- 系统路径 ---
  /** 用户主目录（应用级，如 ~/.coobee-ai） */
  userHome: string;
  /** 系统用户主目录（如 /Users/xxx） */
  systemHome: string;
  /** 系统临时目录 */
  temp: string;
  /** 配置目录（存放 coobee.json5、secrets.json5、skills.json5） */
  configDir: string;
  /** 会话线程目录（{userHome}/threads/，Snowflake ID 有序） */
  threadsDir: string;

  // --- Agent 系统 ---
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

  // --- 数据目录 ---
  /** 当前会话运行产物目录 */
  sessionDir?: string;

  // --- Agent Home ---
  /** Agent 定义 ID（关联了 AgentDefinition 时存在） */
  agentId?: string;
  /** Agent 名称 */
  agentName?: string;
  /** Agent Home 目录（agents/{agentId}/，跨会话持久化空间） */
  agentHome?: string;

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
 * 从全局 Env 构建 Agent 安全环境子集
 *
 * @param sessionId 会话 ID
 * @param project Agent 项目目录（agents/{agentId}/project）
 * @param agentHome Agent Home 路径（可选，用于加载 Agent 级 Skill）
 */
export async function buildAgentEnv(sessionId: string, project: string, agentHome?: string): Promise<AgentEnv> {
  // 延迟导入 Env，避免测试环境循环依赖
  const { Env } = await import('@main/common/env');
  const { SkillManager } = await import('./skills');

  const skillPathSources = await SkillManager.buildDefaultSearchPathSources({ workspace: project, agentHome });
  const skillPaths = SkillManager.searchPathsFromSources(skillPathSources);
  const extensionPaths = await Env.getExtensionSearchPaths(project);

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
    // 系统信息
    platform: process.platform as 'darwin' | 'win32' | 'linux',
    arch: process.arch,
    appVersion: Env.app?.version ?? '0.0.0',

    // 项目目录
    project,
    sessionId,

    // 系统路径
    userHome: Env.paths.userHome,
    systemHome: Env.paths.home,
    temp: Env.paths.temp,
    configDir: Env.paths.configDir,
    threadsDir: Env.paths.threadsDir,

    // Agent 系统
    agentsDir: Env.paths.agentsDir,

    // Skill 系统
    skillPaths,
    skillPathSources,

    // Extension 系统
    extensionPaths,
    builtinExtensionsDir: Env.paths.builtinExtensionsDir,
    userExtensionsDir: Env.paths.userExtensionsDir,
    loadedExtensions,

    // Agent Home（由 prepareAgentEnv 在获取到 agentId 后补充）
    agentId: undefined,
    agentName: undefined,
    agentHome: undefined,

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

// ==================== 提示词注入 ====================

/**
 * 将 AgentEnv 格式化为 <runtime_paths> XML 块
 *
 * 注入到 appendInstructions 中，让 LLM 了解可用路径。
 */
export function formatRuntimePaths(env: AgentEnv): string {
  const extensionsList = env.loadedExtensions.length > 0 ? env.loadedExtensions.join(', ') : 'none';
  const skillPathsList =
    env.skillPathSources.length > 0
      ? '\n' + env.skillPathSources.map((source) => `  - ${source.label} (${source.kind}): ${source.path}`).join('\n')
      : ' none';

  return `<runtime_environment>
Agent:
${env.agentId ? `- id: ${env.agentId}` : ''}
${env.agentName ? `- name: ${env.agentName}` : ''}
- Session: ${env.sessionId}
- model: ${env.defaultModel} (thinking=${env.thinkingLevel})
- platform: ${env.platform}/${env.arch}
- security: sandbox=${env.sandboxMode}, exec=${env.execApproval}
- extensions: ${extensionsList}

Paths:
${env.sessionDir ? `- session_dir: ${env.sessionDir} (current conversation artifacts)` : ''}
${env.agentHome ? `- agent_home: ${env.agentHome} (identity, memory, and Agent-level configuration)` : ''}
- project: ${env.project} (tool cwd and durable business project)
- config: ${env.configDir}
- skill_search_paths:${skillPathsList}
- agents_definitions: ${env.agentsDir}

File usage:
- Save durable business data, records, reports, and knowledge documents in the project directory.
- Use agent_home only for Agent identity, memory, preferences, rules, and configuration.
- Use project for tool outputs, generated reports, indexes, and intermediate files.
- Do not manually edit system-managed session files: session_dir/history.jsonl, session_dir/events.jsonl, session_dir/context.jsonl, session_dir/sessions/.
</runtime_environment>`;
}
