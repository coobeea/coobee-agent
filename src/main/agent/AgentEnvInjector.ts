/**
 * Agent 环境注入器
 *
 * 在 Builder 构建前注入运行时环境：
 *   1. 获取/创建 Agent 工作空间
 *   2. 扫描并加载 Skill（仅 agent 模式）
 *   3. 注入执行协议 + 运行时路径 + Skill 发现提示 + Agent 发现提示（仅 agent 模式）
 *   4. 设置会话存储目录、工作目录、上下文快照目录
 *
 * 运行模式差异：
 *   - chat: 只设置基础环境（workspace, sessionDir, contextDir），不注入工具/Skill/执行协议
 *   - agent: 完整注入（工具 + Skill + 执行协议 + 运行时路径 + Skill 发现提示）
 *
 * 从 AgentExecutor 中提取，专注于环境准备职责。
 */

import path from 'node:path';
import fs from 'node:fs';
import { createLogger } from '@main/common/logger';
import { formatRuntimePaths, buildAgentEnv, type AgentEnv } from './AgentEnv';
import { SkillManager } from './skills';
import { CORE_SKILLS } from './skills/CoreSkills';
import { AgentHomeManager } from './agents/AgentHomeManager';
import { createPathOnlyContext, resolveSandboxContext } from './sandbox';
import type { SandboxMode } from './sandbox';
import type { ToolExecutionContext } from './tools/types';
import type { AgentBuilder } from './AgentExecutor';

const log = createLogger('ai');

/**
 * 注入运行时环境到 Builder
 *
 * @param sessionId - 会话 ID
 * @param builder - Builder 实例
 * @returns workspace 路径（或 undefined）
 */
export async function injectEnv(sessionId: string, builder: AgentBuilder): Promise<string | undefined> {
  try {
    const { Env } = await import('@main/common/env');
    const mode = builder.getMode();

    // 1. 获取/创建工作空间
    // 🆕 检查是否已手动设置 workspace（如子 Agent 手动设置了 workspaceRoot）
    const existingWorkspace = (
      builder as unknown as { getWorkspaceRoot?: () => string | undefined }
    ).getWorkspaceRoot?.();
    const workspace = existingWorkspace || (await Env.getAgentWorkspaceDir(sessionId));

    // 2. 初始化 Agent Home（如果有 agentId）
    const agentId = (builder as unknown as { getAgentId?: () => string | undefined }).getAgentId?.();
    let agentHome: string | undefined;
    let homeManager: AgentHomeManager | undefined;
    if (agentId) {
      homeManager = new AgentHomeManager(Env.paths.homesDir);
      agentHome = homeManager.initHome(agentId);
    }

    // 3. 构建 AgentEnv（传入 agentHome 用于加载 Agent 级 Skill）
    const agentEnv = await buildAgentEnv(sessionId, workspace, agentHome);

    // 4. 设置 AgentEnv 的 agentId 和 agentHome
    if (agentId && agentHome) {
      agentEnv.agentId = agentId;
      agentEnv.agentHome = agentHome;
    }

    // 5. 注入工程目录
    const builderProjectDir = (builder as unknown as { getProjectDir?: () => string | undefined }).getProjectDir?.();
    if (builderProjectDir) {
      agentEnv.projectDir = builderProjectDir;
    }

    // ====== Agent 模式独有：Skill + 执行协议 + 运行时路径 ======
    if (mode === 'agent') {
      // 6. 扫描 Skill 并存储到 SkillManager（供 skill_list 工具按需查询）
      //    使用 agentEnv.skillPaths（已包含 Agent Home skills + Extension 贡献的 Skill 目录）
      //    传入 configDir 以加载 skills.json5 中的 Skill 配置
      const skillManager = new SkillManager();
      skillManager.scanSkills(agentEnv.skillPaths, Env.paths.secretsDir);
      SkillManager.setCurrent(skillManager, sessionId);

      // 7. 注入核心执行协议 + 运行时环境 + Skill 发现提示 + Agent 发现提示到 appendInstructions
      //    执行协议可通过同名 Skill 覆盖（用户在 skills/execution-protocol/ 创建即可）
      // 🔕 执行协议注入已禁用（过于复杂）
      // const executionProtocol = buildExecutionProtocol(skillManager);
      const runtimePathsBlock = formatRuntimePaths(agentEnv);
      // 🔕 简化 Skill 发现提示 - 只保留基本使用说明
      const skillDiscoveryHint =
        skillManager.size > 0
          ? `<skill_discovery>\n` +
            `You have ${skillManager.size} Skills available. Use the \`skill_list\` tool to discover them.\n\n` +
            `**How to use Skills**:\n` +
            `1. Use \`skill_list\` to find available skills\n` +
            `2. Use \`read\` tool to read the skill's SKILL.md file (path provided by skill_list)\n` +
            `3. Follow the instructions in the SKILL.md file\n` +
            `</skill_discovery>`
          : '';
      const agentsMdBlock = await readAgentsMdFiles(Env.paths.agentsMdPath, agentHome, workspace);
      const agentHomeBlock = homeManager && agentId ? homeManager.readInjectableFiles(agentId) : undefined;
      const workspaceCtxBlock = readWorkspaceContextFiles(workspace);

      // 收集 Extension 注入的指令（运行时注入，对所有 Agent 生效）
      const extensionInstructions = collectExtensionInstructions();

      builder.appendInstructions(
        // 🔕 执行协议注入已禁用（过于复杂）
        // executionProtocol,
        runtimePathsBlock,
        ...(agentsMdBlock ? [agentsMdBlock] : []),
        ...(agentHomeBlock ? [agentHomeBlock] : []),
        ...(workspaceCtxBlock ? [workspaceCtxBlock] : []),
        ...(skillDiscoveryHint ? [skillDiscoveryHint] : []),
        ...extensionInstructions
      );

      // 7b. 注入核心技能到 builder（确保子 Agent 也拥有核心技能）
      //     builder.skills() 是累加模式，不会覆盖已有 skills
      const coreSkillDefs = CORE_SKILLS.map((name) => skillManager.getByName(name)).filter(
        (s): s is NonNullable<typeof s> => s !== null
      );
      if (coreSkillDefs.length > 0) {
        builder.skills(coreSkillDefs);
        log.info(
          `[EnvInjector] Injected ${coreSkillDefs.length} core skills: ${coreSkillDefs.map((s) => s.name).join(', ')}`
        );
      }

      // 7c. 注入工具到 builder（如果 builder 还没有设置工具）
      //     从 ToolRegistry 获取所有已注册的工具（builtin + Extension）
      //     过滤：应用 Agent 定义的 excludeTools 黑名单
      if (!(builder as unknown as { _tools?: unknown })._tools) {
        const { ToolRegistry } = await import('./tools/registry');
        const allTools = ToolRegistry.getInstance().getAll();

        // 从 AgentStore 加载 Agent 定义（如果有 agentId）
        let excludeTools: string[] = [];
        if (agentId) {
          try {
            const { AgentStore } = await import('./agents/AgentStore');
            const store = await AgentStore.getInstance();
            const agentDef = await store.get(agentId);
            if (agentDef?.excludeTools) {
              excludeTools = agentDef.excludeTools;
              log.info(`[EnvInjector] Agent ${agentId} excludes tools: ${excludeTools.join(', ')}`);
            }
          } catch (error) {
            log.warn(`[EnvInjector] Failed to load agent definition for ${agentId}:`, error);
          }
        }

        // 应用黑名单过滤
        const excludeSet = new Set(excludeTools);
        const filteredTools = allTools.filter((t) => !excludeSet.has(t.name));

        builder.tools(filteredTools);
        log.info(
          `[EnvInjector] Injected ${filteredTools.length} tools from ToolRegistry` +
            (excludeTools.length > 0 ? ` (excluded ${excludeTools.length})` : '')
        );
      }

      // 8. 构建工具执行上下文（由 Runtime 的 convertTools 注入到每个工具）
      //    包含沙箱信息 + Agent/Session 上下文
      //    有工程目录时，工具操作的根目录指向工程目录
      const effectiveCwd = builderProjectDir || workspace;
      const envVars = buildSkillEnvVars(agentEnv);
      const toolCtx = await buildToolExecutionContext(effectiveCwd, sessionId, envVars, {
        agentId: agentId || undefined,
        agentName: builder.getName?.() || undefined,
        agentMode: mode
      });
      builder.sandboxContext(toolCtx);
    }

    // ====== Chat & Agent 共享：基础环境设置 ======

    // 9. 设置会话存储目录（指向 .runtime/ 系统空间，始终在 workspace 内）
    builder.sessionDir(path.join(workspace, '.runtime', 'sessions'));

    // 10. 工作目录：有工程目录时优先使用工程目录，否则用 workspace
    const effectiveCwdShared = builderProjectDir || workspace;
    builder.workspaceRoot(effectiveCwdShared);

    // 11. 设置上下文快照目录（.runtime/ 系统空间，始终在 workspace 内）
    builder.contextDir(path.join(workspace, '.runtime', 'contexts'));

    if (builderProjectDir) {
      log.info(
        `[EnvInjector] Injected: sessionId=${sessionId}, mode=${mode}, workspace=${workspace}, projectDir=${builderProjectDir}`
      );
    } else {
      log.info(`[EnvInjector] Injected: sessionId=${sessionId}, mode=${mode}, workspace=${workspace}`);
    }
    return workspace;
  } catch (error) {
    log.warn(`[EnvInjector] Failed, continuing without env:`, error);
    return undefined;
  }
}

// ==================== 工作空间上下文文件读取 ====================

/**
 * 扫描工作空间根目录下的用户 .md 文件，作为会话级持久上下文注入
 *
 * 只读取工作空间根下的 .md 文件（不递归），不包含 .runtime/ 等系统目录下的文件。
 *
 * 典型用例：Agent 在上一轮对话中写入 discussion_summary.md，
 * 下一轮对话自动加载，保持跨轮次的对话连续性。
 */
function readWorkspaceContextFiles(workspace: string): string | undefined {
  const EXCLUDED = new Set<string>();
  const maxTotalLen = 6000;
  const maxPerFile = 3000;

  try {
    const entries = fs.readdirSync(workspace, { withFileTypes: true });
    const mdFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith('.md') && !EXCLUDED.has(e.name))
      .map((e) => e.name)
      .sort();

    if (mdFiles.length === 0) return undefined;

    const sections: string[] = [];
    let totalLen = 0;

    for (const file of mdFiles) {
      if (totalLen >= maxTotalLen) break;
      const filePath = path.join(workspace, file);
      try {
        let content = fs.readFileSync(filePath, 'utf-8').trim();
        if (!content) continue;
        if (content.length > maxPerFile) {
          content = content.slice(0, maxPerFile) + '\n\n... (truncated)';
        }
        const section = `### ${file}\n\n${content}`;
        sections.push(section);
        totalLen += section.length;
      } catch {
        // 跳过不可读文件
      }
    }

    if (sections.length === 0) return undefined;

    return `<workspace_context>
Session-persistent context files from the workspace root.
These were created in previous conversation turns and auto-loaded for continuity.
You may update or add new files in the workspace root to persist information across turns.

${sections.join('\n\n---\n\n')}
</workspace_context>`;
  } catch {
    return undefined;
  }
}

// ==================== AGENTS.md 协议文件读取 ====================

/**
 * 读取并合并二级 AGENTS.md 协议文件
 *
 * 优先级（后者可覆盖前者规则）：
 *   1. 全局 AGENTS.md（{userHome}/AGENTS.md）— 系统级规则（所有 Agent 共享）
 *   2. Agent级 AGENTS.md（homes/{agentId}/AGENTS.md）— Agent 自定义规则（跨会话持久）
 *
 * @param globalPath 全局 AGENTS.md 路径
 * @param agentHome Agent Home 目录路径（可选）
 * @param _workspace 工作空间根路径（已废弃，仅保留参数兼容）
 * @returns `<system_agents_md>` XML 块，或 undefined
 */
async function readAgentsMdFiles(
  globalPath: string,
  agentHome: string | undefined,
  _workspace: string
): Promise<string | undefined> {
  // 🔓 取消截断限制 - 完整加载 AGENTS.md 内容
  const parts: string[] = [];
  const seenContent = new Set<string>();

  // 1. 全局 AGENTS.md
  try {
    const content = fs.readFileSync(globalPath, 'utf-8').trim();
    if (content) {
      parts.push(content);
      seenContent.add(content);
    }
  } catch {
    // 文件不存在时静默
  }

  // 2. Agent级 AGENTS.md
  const agentMdPath = agentHome ? path.join(agentHome, 'AGENTS.md') : undefined;
  if (agentMdPath) {
    try {
      const content = fs.readFileSync(agentMdPath, 'utf-8').trim();
      if (content && !seenContent.has(content) && !isOnlyComments(content)) {
        parts.push(`---\n\n<!-- Agent-level rules (${agentMdPath}) -->\n\n${content}`);
        seenContent.add(content);
      }
    } catch {
      // 文件不存在时静默
    }
  }

  if (parts.length === 0) return undefined;

  // 🔓 不再截断，完整加载
  const merged = parts.join('\n\n');

  const pathLines = [`Global path: ${globalPath}`];
  if (agentMdPath) pathLines.push(`Agent path: ${agentMdPath}`);

  return `<system_agents_md>
This is the system-wide AGENTS.md protocol file. It contains identity, rules, and shared context
that ALL agents MUST follow. You may update the Agent-level copy in your Agent Home directory.

${pathLines.join('\n')}

${merged}
</system_agents_md>`;
}

/**
 * 判断内容是否仅包含 Markdown 注释
 */
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

// ==================== Skill 上下文环境变量 ====================

/**
 * 构建注入子进程的 COOBEE_* 环境变量
 *
 * Skill 脚本通过这些变量获取运行时上下文：
 *   - COOBEE_CONFIG_DIR     — 配置目录（读取 skills.json5 等）
 *   - COOBEE_WORKSPACE      — 工作空间目录
 *   - COOBEE_SESSION_ID     — 当前会话 ID
 *   - COOBEE_USER_HOME      — 应用主目录
 */
function buildSkillEnvVars(env: AgentEnv): Record<string, string> {
  const vars: Record<string, string> = {
    COOBEE_CONFIG_DIR: env.configDir,
    COOBEE_WORKSPACE: env.workspace,
    COOBEE_SESSION_ID: env.sessionId,
    COOBEE_USER_HOME: env.userHome
  };
  if (env.projectDir) {
    vars.COOBEE_PROJECT_DIR = env.projectDir;
  }
  return vars;
}

// ==================== 工具执行上下文构建 ====================

/** Agent 上下文信息（由调用方传入） */
interface AgentContextInfo {
  agentId?: string;
  agentName?: string;
  agentType?: import('./threads/types').AgentType;
  agentMode?: import('./runtime/types').AgentMode;
  parentSessionId?: string;
}

/**
 * 构建工具执行上下文（ToolExecutionContext）
 *
 * 在沙箱上下文基础上，注入 Agent/Session/Thread 维度 + 工作空间路径 + 系统路径。
 * 工具执行函数通过此上下文获取完整的运行环境，无需自行 path.join 或动态 import Env。
 *
 * 沙箱模式从 ConfigStore 读取 security.sandbox.mode：
 *   - 'off': 无沙箱保护
 *   - 'path-only': 路径守卫（默认）
 *   - 'docker': Docker 容器隔离
 */
async function buildToolExecutionContext(
  workspace: string,
  sessionId: string,
  envVars: Record<string, string>,
  agentInfo?: AgentContextInfo
): Promise<ToolExecutionContext> {
  let sandboxMode: SandboxMode = 'path-only';

  try {
    const { configStoreInstance } = await import('@main/common/config/ConfigStore');
    if (configStoreInstance) {
      const security = configStoreInstance.get('security');
      const configMode = security?.sandbox?.mode;
      if (configMode) {
        sandboxMode = configMode;
        log.info(`[EnvInjector] Sandbox mode from config: ${sandboxMode}`);
      }
    }
  } catch {
    // ConfigStore 不可用时使用默认值
  }

  // 构建基础沙箱上下文
  let baseCtx;
  if (sandboxMode === 'off') {
    baseCtx = {
      mode: 'off' as const,
      workspaceRoot: workspace,
      toolPolicy: { allow: [] as string[], deny: [] as string[] },
      sessionId,
      envVars
    };
  } else if (sandboxMode === 'docker') {
    baseCtx = await resolveSandboxContext({ mode: 'docker', workspaceRoot: workspace }, sessionId);
    baseCtx.envVars = envVars;
  } else {
    baseCtx = createPathOnlyContext(workspace, { sessionId, envVars });
  }

  // 系统路径（从 Env 读取，失败时用合理默认值）
  let userHome = '';
  let configDir = '';
  let tempDir = '';
  try {
    const { Env } = await import('@main/common/env');
    userHome = Env.paths.userHome;
    configDir = Env.paths.configDir;
    tempDir = Env.paths.temp;
  } catch {
    const os = await import('node:os');
    userHome = path.join(os.homedir(), '.coobee-ai');
    configDir = path.join(userHome, 'config');
    tempDir = os.tmpdir();
  }

  // threadId：顶层 sessionId 即为 threadId，子 Agent 的 sessionId 含 `:` 分隔符
  const threadId = sessionId.includes(':') ? sessionId.split(':')[0] : sessionId;

  // cwd：Docker 模式用容器内工作目录，否则用 workspaceRoot
  const cwd = baseCtx.docker?.workdir || workspace;

  const toolCtx: ToolExecutionContext = {
    // 沙箱基础
    ...baseCtx,
    sessionId,

    // 会话标识
    threadId,

    // 工作目录
    cwd,

    // 工作空间目录
    tasksDir: path.join(workspace, 'tasks'),

    // 系统空间（.runtime/）
    sessionsDir: path.join(workspace, '.runtime', 'sessions'),
    contextsDir: path.join(workspace, '.runtime', 'contexts'),
    eventsDir: path.join(workspace, '.runtime', 'events'),

    // 系统路径
    userHome,
    configDir,
    tempDir,

    // Agent 信息（必填）
    agentName: agentInfo?.agentName || 'agent',
    agentMode: agentInfo?.agentMode || 'agent',

    // Agent 信息（可选）
    agentId: agentInfo?.agentId,
    agentType: agentInfo?.agentType,
    parentSessionId: agentInfo?.parentSessionId
  };

  return toolCtx;
}

// ==================== Extension 指令注入 ====================

/**
 * 收集所有 Extension 注入的指令
 *
 * Extension 可通过 extension.json 的 injectInstructions 字段声明运行时指令，
 * 这些指令会在每次 Agent 运行时自动追加到 appendInstructions 中。
 *
 * 适用场景：核心功能的使用指导（如 memory-smart 召回）对所有 Agent 生效，无需修改 Agent 定义。
 */
function collectExtensionInstructions(): string[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ExtensionManager } = require('@main/common/extension');
    const registry = ExtensionManager.getRegistry();
    if (registry) {
      return registry.getInjectInstructions();
    }
  } catch {
    // Extension 系统未初始化时忽略
  }
  return [];
}
