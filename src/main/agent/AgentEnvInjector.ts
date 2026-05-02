/**
 * Agent 环境注入器
 *
 * 在 Runtime 构建前准备运行时环境：
 *   1. 获取/创建 Agent 项目目录
 *   2. 扫描并加载 Skill（仅 agent 模式）
 *   3. 根据 Agent 配置收集 Skills（仅 agent 模式）
 *   4. 准备运行时路径 + Skill 发现提示 + Agent 发现提示（仅 agent 模式）
 *   5. 返回会话存储目录、工作目录、上下文快照目录
 *
 * 运行模式差异：
 *   - chat: 只设置基础环境（workspace, sessionDir, contextDir），不注入工具/Skill
 *   - agent: 根据 Agent 配置注入（工具 + Skills + 运行时路径 + Skill 发现提示）
 *
 * Skill 注入策略：
 *   - 不再强制注入核心 Skills
 *   - 完全根据 Agent 配置文件中的 skills 数组决定
 *   - 空数组 = 不注入任何 Skill
 *
 * 只返回配置，不直接修改 AgentRuntimeBuilder。
 */

import path from 'node:path';
import { createLogger } from '@main/common/logger';
import { buildAgentEnv, ensureAgentRuntimeLayout, type AgentEnv, type AgentRuntimeLayout } from './AgentEnv';
import { SkillManager } from './skills';
import { createPathOnlyContext, resolveSandboxContext } from './sandbox';
import type { SandboxMode } from './sandbox';
import type { ToolExecutionContext } from './tools/types';
import type { AgentMode, SkillDefinition, ThinkingLevel, ToolDefinition } from './runtime/types';
import { buildSystemPrompt } from './prompt/SystemPromptBuilder';

const log = createLogger('ai');

export interface PrepareAgentEnvOptions {
  // --- Agent 身份 ---
  /** Agent 定义 ID（必填），运行时产物统一落在 \`.home/agents/{agentId}/...\` */
  agentId: string;
  /** Agent 名称，未指定时默认使用 agentId */
  agentName?: string;

  // --- 会话 ---
  /** 当前会话 ID */
  sessionId: string;

  // --- 运行模式 ---
  /** 运行模式：\`chat\` 仅基础环境，\`agent\` 注入 Skill + 工具 + 执行协议 */
  mode: AgentMode;

  // --- 模型 ---
  /** 思维链级别，\`'off'\` 表示禁用思考 */
  thinkingLevel?: ThinkingLevel;
}

export interface PreparedAgentEnv {
  /** Agent 可见的完整运行时环境（路径、系统、配置等） */
  env: AgentEnv;

  // --- 指令与 Skill ---
  /** 追加到系统提示词的指令块（运行时路径、Skill 发现提示、Extension 指令等） */
  appendInstructions: string[];
  /** Agent 配置中指定的 Skill 定义列表 */
  skills: SkillDefinition[];

  // --- 工具 ---
  /** 从 ToolRegistry 收集的工具定义（已应用 excludeTools 黑名单过滤） */
  tools?: ToolDefinition[];

  // --- 执行沙箱 ---
  /** 工具执行沙箱上下文（沙箱模式、可写路径、环境变量等） */
  sandboxContext?: ToolExecutionContext;
}

/**
 * 准备运行时环境配置。
 *
 * 注意：这里不再接收/修改 Builder。调用方拿到返回值后，统一在最后创建 Builder 并 build Runtime。
 */
export async function prepareAgentEnv(options: PrepareAgentEnvOptions): Promise<PreparedAgentEnv> {
  try {
    const { Env } = await import('@main/common/env');
    const { sessionId, mode, agentId, agentName } = options;

    if (!agentId) {
      throw new Error(`[EnvInjector] agentId is required: sessionId=${sessionId}`);
    }

    // 1. 构建 AgentEnv（路径计算在 buildAgentEnv 内部完成）
    const agentEnv = await buildAgentEnv({ agentId, sessionId, agentName });
    if (options.thinkingLevel) {
      agentEnv.thinkingLevel = options.thinkingLevel;
    }

    // 2. 确保运行时目录存在（agentHome/projectDir/sessionDir 等）
    await ensureAgentRuntimeLayout(agentEnv as AgentRuntimeLayout);

    const projectDir = agentEnv.projectDir;
    const sessionDir = agentEnv.sessionDir;

    // 读取 Agent 定义以获取 skills 配置
    let agentDefinedSkills: string[] | undefined;
    let excludeTools: string[] = [];
    {
      const { AgentStore } = await import('./agents/AgentStore');
      const store = await AgentStore.getInstance();
      const agentDef = await store.get(agentId);
      if (agentDef) {
        agentDefinedSkills = agentDef.skills;
        excludeTools = agentDef.excludeTools || [];
        log.debug(`[EnvInjector] Agent defined skills: ${agentDefinedSkills?.join(', ') || '(none)'}`);
      }
    }

    const prepared: PreparedAgentEnv = {
      env: agentEnv,
      appendInstructions: [],
      skills: []
    };

    // ====== Agent 模式独有：Skill + 执行协议 + 运行时路径 ======
    if (mode === 'agent') {
      // 7. 扫描 Skill 并存储到 SkillManager（供 skill_list 工具按需查询）
      //    使用 agentEnv.skillPathSources（由 SkillManager 统一管理来源与优先级）
      //    传入 configDir 以加载 skills.json5 中的 Skill 配置
      const skillManager = new SkillManager();
      skillManager.registerSearchPaths(agentEnv.skillPathSources);
      skillManager.scanRegisteredSkills(Env.paths.secretsDir);
      SkillManager.setCurrent(skillManager, sessionId);

      // 8. 构建系统提示词注入块（runtime_environment + skill_discovery + extension_instructions）
      //    由 SystemPromptBuilder 统一管理，执行协议注入已禁用
      const extensionInstructions = collectExtensionInstructions();
      const instructions = buildSystemPrompt({
        agentEnv,
        skillManager,
        agentDefinedSkills,
        extensionInstructions,
        agentsDir: Env.paths.agentsDir
      });

      prepared.appendInstructions.push(...instructions);

      // 8b. 根据 Agent 配置注入 Skills（不再强制注入核心 Skills）
      //     只注入 Agent 配置文件中指定的 skills
      if (agentDefinedSkills && agentDefinedSkills.length > 0) {
        const skillDefs = agentDefinedSkills
          .map((name) => skillManager.getByName(name))
          .filter((s): s is NonNullable<typeof s> => s !== undefined);

        if (skillDefs.length > 0) {
          prepared.skills.push(...skillDefs);
          log.info(
            `[EnvInjector] Injected ${skillDefs.length} agent skills: ${skillDefs.map((s) => s.name).join(', ')}`
          );
        }

        // 警告：如果配置的 skill 找不到
        const notFound = agentDefinedSkills.filter((name) => !skillDefs.find((s) => s.name === name));
        if (notFound.length > 0) {
          log.warn(`[EnvInjector] Skills not found: ${notFound.join(', ')}`);
        }
      } else {
        log.debug(`[EnvInjector] No skills configured for agent ${agentId || '(unknown)'}`);
      }

      // 8c. 收集工具
      //     从 ToolRegistry 获取所有已注册的工具（builtin + Extension）
      //     过滤：应用 Agent 定义的 excludeTools 黑名单
      const { ToolRegistry } = await import('./tools/registry');
      const allTools = ToolRegistry.getInstance().getAll();

      if (agentId && excludeTools.length > 0) {
        log.info(`[EnvInjector] Agent ${agentId} excludes tools: ${excludeTools.join(', ')}`);
      }

      // 应用黑名单过滤
      const excludeSet = new Set(excludeTools);
      const filteredTools = allTools.filter((t) => !excludeSet.has(t.name));

      prepared.tools = filteredTools;
      log.info(
        `[EnvInjector] Injected ${filteredTools.length} tools from ToolRegistry` +
          (excludeTools.length > 0 ? ` (excluded ${excludeTools.length})` : '')
      );

      // 8. 构建工具执行上下文（由 Runtime 的 convertTools 注入到每个工具）
      //    包含沙箱信息 + Agent/Session 上下文
      //    注意：当前 tool cwd 固定为 Agent projectDir
      //    如果未来需要支持"一个 Agent 操作多个项目目录"，应在 Builder 中增加 projectDir() 方法
      const effectiveCwd = projectDir;
      if (!effectiveCwd) {
        throw new Error('[EnvInjector] projectDir is undefined, cannot build tool execution context');
      }
      const envVars = buildSkillEnvVars(agentEnv);
      const toolCtx = await buildToolExecutionContext(
        effectiveCwd,
        sessionId,
        envVars,
        agentId,
        sessionDir,
        agentName,
        mode
      );
      prepared.sandboxContext = toolCtx;
    }

    log.info(`[EnvInjector] Prepared: sessionId=${sessionId}, mode=${mode}, projectDir=${projectDir}`);
    return prepared;
  } catch (error) {
    log.error(`[EnvInjector] Failed to prepare runtime env: ${formatUnknownError(error)}`);
    throw error;
  }
}

// ==================== Skill 上下文环境变量 ====================

/**
 * 构建注入子进程的 COOBEE_* 环境变量
 *
 * Skill 脚本通过这些变量获取运行时上下文：
 *   - COOBEE_CONFIG_DIR     — 配置目录（读取 skills.json5 等）
 *   - COOBEE_PROJECT        — Agent 项目目录（工具 cwd）
 *   - COOBEE_WORKSPACE      — 已废弃，等同 COOBEE_PROJECT
 *   - COOBEE_SESSION_ID     — 当前会话 ID
 *   - COOBEE_USER_HOME      — 应用主目录
 */
function buildSkillEnvVars(env: AgentEnv): Record<string, string> {
  const vars: Record<string, string> = {
    COOBEE_CONFIG_DIR: env.configDir,
    COOBEE_PROJECT: env.projectDir,
    COOBEE_WORKSPACE: env.projectDir,
    COOBEE_SESSION_ID: env.sessionId,
    COOBEE_SESSION_DIR: env.sessionDir,
    COOBEE_USER_HOME: env.userHome
  };
  return vars;
}

// ==================== 工具执行上下文构建 ====================

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
  agentId: string,
  sessionDir: string,
  agentName?: string,
  agentMode?: import('./runtime/types').AgentMode
): Promise<ToolExecutionContext> {
  if (!agentId || !sessionDir) {
    throw new Error(
      `[EnvInjector] agentId and sessionDir are required to build tool execution context: sessionId=${sessionId}`
    );
  }
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
    baseCtx = await resolveSandboxContext(
      { mode: 'docker', workspaceRoot: workspace, writableRoots: compactPaths([workspace]) },
      sessionId
    );
    baseCtx.envVars = envVars;
  } else {
    baseCtx = createPathOnlyContext(workspace, {
      sessionId,
      envVars,
      writableRoots: compactPaths([workspace])
    });
  }

  // 系统路径必须来自 Env；这里不能使用测试目录兜底，否则工具和会话路径会漂移。
  let userHome = '';
  let configDir = '';
  let tempDir = '';
  try {
    const { Env } = await import('@main/common/env');
    userHome = Env.paths.userHome;
    configDir = Env.paths.configDir;
    tempDir = Env.paths.temp;
  } catch (error) {
    throw new Error(
      `[EnvInjector] Env paths are required to build tool execution context: ${formatUnknownError(error)}`
    );
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

    // 项目目录派生的任务目录
    tasksDir: path.join(workspace, 'tasks'),

    // 系统空间（严格走 AgentRuntimeLayout，禁止回退到 workspace）
    sessionDir: sessionDir,
    sessionsDir: path.join(sessionDir, 'sessions'),
    contextsDir: sessionDir,
    eventsDir: sessionDir,

    // 系统路径
    userHome,
    configDir,
    tempDir,

    // Agent 信息（必填）
    agentName: agentName || 'agent',
    agentMode: agentMode || 'agent',

    // Agent 信息
    agentId: agentId,
    parentSessionId: undefined
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
    const { ExtensionManager } = require('@main/extension');
    const registry = ExtensionManager.getRegistry();
    if (registry) {
      return registry.getInjectInstructions();
    }
  } catch {
    // Extension 系统未初始化时忽略
  }
  return [];
}

function compactPaths(paths: Array<string | undefined>): string[] {
  return paths.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  return String(error);
}
