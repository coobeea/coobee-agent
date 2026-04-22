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

import path from 'node:path';

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
  /** 是否为开发模式 */
  isDev: boolean;
  /** 应用版本 */
  appVersion: string;

  // --- 工作空间 ---
  /** 工作空间根目录 */
  workspace: string;
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
  /** 用户 Agent 目录（可读写） */
  userAgentsDir: string;

  // --- Skill 系统 ---
  /** Skill 搜索路径（按优先级从低到高） */
  skillPaths: string[];
  /** 内置 Skill 目录 */
  builtinSkillsDir: string;
  /** 用户 Skill 目录 */
  userSkillsDir: string;

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
  /** Agent 专属的数据目录（持久化业务数据） */
  dataDirectory?: string;

  // --- Agent Home ---
  /** Agent 定义 ID（关联了 AgentDefinition 时存在） */
  agentId?: string;
  /** Agent 名称 */
  agentName?: string;
  /** Agent Home 目录（homes/{agentId}/，跨会话持久化空间） */
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
 * @param workspace Agent 工作空间路径（由 Env.getAgentWorkspaceDir 返回）
 * @param agentHome Agent Home 路径（可选，用于加载 Agent 级 Skill）
 */
export async function buildAgentEnv(sessionId: string, workspace: string, agentHome?: string): Promise<AgentEnv> {
  // 延迟导入 Env，避免测试环境循环依赖
  const { Env } = await import('@main/common/env');

  const skillPaths = await Env.getSkillSearchPaths(workspace, agentHome);
  const extensionPaths = await Env.getExtensionSearchPaths(workspace);

  // Extension 系统信息
  let loadedExtensions: string[] = [];
  let availableTools: string[] = [];

  try {
    const { ExtensionManager } = await import('@main/common/extension');
    const registry = ExtensionManager.getRegistry();
    if (registry) {
      // 合并扩展贡献的 Skill 目录
      // 优先级：内置(1) → 扩展贡献(1.5) → 用户级(2) → 工作空间(3)
      const extSkillDirs = registry.getSkillDirs().map((s) => s.dir);
      if (extSkillDirs.length > 0) {
        const builtinIdx = skillPaths.indexOf(Env.paths.builtinSkillsDir);
        const insertIdx = builtinIdx >= 0 ? builtinIdx + 1 : 0;
        skillPaths.splice(insertIdx, 0, ...extSkillDirs);
      }

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
    isDev: Env.isDev,
    appVersion: Env.app?.version ?? '0.0.0',

    // 工作空间
    workspace,
    sessionId,

    // 系统路径
    userHome: Env.paths.userHome,
    systemHome: Env.paths.home,
    temp: Env.paths.temp,
    configDir: Env.paths.configDir,
    threadsDir: Env.paths.threadsDir,

    // Agent 系统
    userAgentsDir: Env.paths.userAgentsDir,

    // Skill 系统
    skillPaths,
    builtinSkillsDir: Env.paths.builtinSkillsDir,
    userSkillsDir: Env.paths.userSkillsDir,

    // Extension 系统
    extensionPaths,
    builtinExtensionsDir: Env.paths.builtinExtensionsDir,
    userExtensionsDir: Env.paths.userExtensionsDir,
    loadedExtensions,

    // Agent Home（由 injectEnv 在获取到 agentId 后补充）
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
  // 格式化扩展列表
  const extensionsList = env.loadedExtensions.length > 0 ? env.loadedExtensions.join(', ') : 'none';

  const agentHomeSection = env.agentHome
    ? `
**Agent Home (Your Root Directory)**: ${env.agentHome}/
  ├── IDENTITY.md                           — 身份名片：名字、风格、签名
  ├── SOUL.md                               — 核心灵魂：行为原则、风格定调
  ├── USER.md                               — 主人档案：用户称呼、偏好
  ├── NOTES.md                              — 环境工具备注：特殊配置
  ├── HEARTBEAT.md                          — 心跳任务清单：定期任务
  ├── AGENTS.md                             — Agent 级规则 + 技能配置
  └── BOOTSTRAP.md                          — 引导文件（初始化配置）

  **PURPOSE**: Agent 的人格配置和记忆文件。这些 Markdown 文件定义了 Agent 的身份、
  行为原则、用户偏好等。系统会将这些文件的内容注入到 System Prompt 中。
`
    : '';

  const dataDirectorySection = env.dataDirectory
    ? `
📂 **数据目录 / Data Directory (IMPORTANT)**: \`${env.dataDirectory}/\`
  
  ⚠️ **这是你的专属数据存储区，非常重要！**
  
  **用途**：
  - 持久化存储所有业务数据（客户信息、进销存记录、知识库、文档等）
  - 跨任务、跨会话的数据共享（今天保存的数据，明天仍可访问）
  - 这是固定的目录，不会因为任务结束而清理
  
  **何时使用**：
  - 用户要求保存、记录、存储任何业务数据时 → 保存到数据目录
  - 用户询问"之前的记录""历史数据""上次的文件"时 → 从数据目录读取
  - 生成报表、分析结果、知识文档时 → 保存到数据目录
  
  **路径**: \`${env.dataDirectory}\`
`
    : '';

  return `<runtime_environment>
Your Runtime Environment:
${env.agentId ? `- Agent ID: ${env.agentId}` : ''}
${env.agentName ? `- Agent Name: ${env.agentName}` : ''}
- Session: ${env.sessionId}
${env.dataDirectory ? `- 数据目录 (Data Dir): ${env.dataDirectory}` : ''}
- Internal Workspace: ${env.workspace}
- Platform: ${env.platform}/${env.arch} (${env.isDev ? 'dev' : 'prod'})
- Security: sandbox=${env.sandboxMode}, exec=${env.execApproval}
- Model: ${env.defaultModel} (thinking=${env.thinkingLevel})
- Extensions: ${extensionsList}

Directory Structure:
${dataDirectorySection}
${agentHomeSection}
**Current Task Workspace (Internal/Temporary)**: ${env.workspace}/
  ├── sessions/                             — SDK session files
  │   ├── session.jsonl                         (OpenAI)
  │   └── {timestamp}_{uuid}.jsonl              (PiMono)
  ├── history.jsonl                         — Aggregated message history (frontend display)
  ├── events.jsonl                          — Debug event logs
  ├── context.jsonl                         — Context snapshots (append-only)
  └── tasks/                                — Multi-agent collaboration area

  **PURPOSE**: This is the internal sandbox for the CURRENT task.
  Files here are task-specific and may be cleaned up after task completion.

Key System Directories:
- Data Directory: ${env.dataDirectory || '{dataDirectory}'}          — Agent 专属数据目录（业务数据持久化）
- Agent Home: ${env.agentHome || '{agentHome}'}            — Agent 配置和记忆文件
- Config: ${env.configDir}                          — 全局配置
- Skills: builtin=${env.builtinSkillsDir}, user=${env.userSkillsDir}  — Skills 搜索路径
- Agents Definitions: ${env.userAgentsDir}              — Agent 定义文件目录

File Output Guidelines:

**Where to save files?**
${
  env.dataDirectory
    ? `
1. **数据目录（首选！业务数据持久化）** → ${env.dataDirectory}/
   ⚠️ 优先级最高！所有业务数据都应保存到这里！
   - 客户信息、进销存记录、知识库、分析报告、文档等
   - 跨任务的持久化数据，下次开启新任务时可以继续访问
   - 这是智能体专属的固定数据存储位置
   - 用户要求"保存数据""记录信息""生成报告"时，默认使用此目录
`
    : ''
}

${env.dataDirectory ? '2' : '1'}. **Agent Home（配置和记忆）** → ${env.agentHome || '{agentHome}'}/
   - IDENTITY.md      — 身份名片
   - SOUL.md          — 核心灵魂和行为原则
   - USER.md          — 用户偏好和使用习惯
   - NOTES.md         — 环境备注和特殊配置
   - HEARTBEAT.md     — 定期检查任务
   - AGENTS.md        — Agent 级规则和技能配置

${env.dataDirectory ? '3' : '2'}. **Temporary Task Files** → Current Task Workspace
   - ${env.workspace}/  — 临时文件、中间结果
   - 任务结束后可能被清理

${env.dataDirectory ? '4' : '3'}. **System Files** (DO NOT manually modify)
   - {workspace}/sessions/         — Session data (managed by system)
   - {workspace}/history.jsonl     — Aggregated history (managed by system)
   - {workspace}/events.jsonl      — Event logs (managed by system)
   - {workspace}/context.jsonl     — Context snapshots (managed by system)
${
  env.dataDirectory
    ? `

**重要提示**：你有专属的数据目录 \`${env.dataDirectory}\`，所有业务数据都应保存到这里！`
    : `

**IMPORTANT**: When user asks "check our root directory" or similar, they usually mean ${env.agentHome ? `Agent Home (${env.agentHome})` : 'the current workspace'}.`
}
</runtime_environment>`;
}
