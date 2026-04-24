/**
 * Extension 系统类型定义
 *
 * 统一命名：所有公开类型使用 Extension 前缀。
 * Extension 系统提供三种能力注册：Agent 生命周期钩子、工具、Gateway 方法。
 */

import type { ToolDefinition } from '../agent/tools/types';
export type MethodHandler = (params: unknown, ctx?: unknown) => Promise<unknown> | unknown;

// ==================== Extension 模块 ====================

/** Extension 清单（extension.json） */
export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  /**
   * 设为 false 可禁用此 Extension，加载器会跳过它。
   * 省略或 true 表示启用（默认行为）。
   */
  enabled?: boolean;
  /**
   * 扩展贡献的 Skill 目录（相对于扩展根目录）
   *
   * 声明后，该目录下的 Skill 会被 Skill 加载器自动发现。
   * @example "skills" → <extensionDir>/skills/
   */
  skills?: string;
  /**
   * 自动注入的 Skill 名称列表
   *
   * 列表中的 Skill 会自动注入到所有 Agent，无需手动激活。
   * 适用于核心功能型 Skill（如记忆系统、日志等）。
   * @example ["memory-smart", "logger"]
   */
  autoInjectSkills?: string[];
  /**
   * 运行时自动注入的指令（追加到 Agent appendInstructions）
   *
   * 每次 Agent 运行时自动追加此指令，适用于需要动态注入能力的场景。
   * 相比 autoInjectSkills（仅对新 Agent 有效），指令注入对所有 Agent（包括已有）立即生效。
   * @example "You have access to memory-smart: use Read tool to query ~/.coobee-ai/memory/agent/{agentId}/"
   */
  injectInstructions?: string;
}

/** Extension 来源 */
export type ExtensionOrigin = 'builtin' | 'user' | 'workspace';

/** Extension 模块导出格式 */
export interface ExtensionModule {
  id: string;
  name: string;
  register: (api: ExtensionApi) => void | Promise<void>;
  /** 可选的卸载回调（热重载或应用退出时调用） */
  unregister?: () => void | Promise<void>;
}

/** Extension 日志 */
export interface ExtensionLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}

/** Extension EventBus 接口 */
export interface ExtensionEventBus {
  on<T = unknown>(event: string, handler: (data: T) => void): void;
  off<T = unknown>(event: string, handler: (data: T) => void): void;
  emit<T = unknown>(event: string, data: T): void;
}

// ==================== ExtensionApi ====================

export interface ChannelContext {
  /** Channel 绑定的 AbortSignal，用于安全退出 */
  abortSignal: AbortSignal;
  /** 日志 */
  log: ExtensionLogger;
}

export interface ChannelConfig {
  /** 通道唯一 ID */
  id: string;
  /** 通道名称 */
  name: string;
  /** Gateway 生命周期钩子 */
  gateway?: {
    /** 启动通道监听 */
    start?: (ctx: ChannelContext) => Promise<void> | void;
    /** 停止通道监听 */
    stop?: (ctx: ChannelContext) => Promise<void> | void;
  };
}

export interface HttpRouteConfig {
  /** 路由路径，例如 '/webhook/tavern' */
  path: string;
  /** HTTP 方法 */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /** Koa 处理器函数 (使用 Record 避免耦合 Koa 类型) */
  handler: (ctx: Record<string, unknown>) => Promise<void> | void;
}

export interface BackgroundService {
  /** 服务唯一 ID */
  id: string;
  /** 启动服务 */
  start: () => Promise<void> | void;
  /** 停止服务 */
  stop: () => Promise<void> | void;
}

/**
 * Extension Services — 核心能力的结构化访问接口
 *
 * Extension 通过 api.services 访问系统服务，避免直接 import 核心模块。
 * 服务实例由 ExtensionManager 在注册时注入。
 *
 * **设计原则**：
 * 1. Extension 禁止直接 import src/main/ 模块（避免 jiti 嵌套导入问题）
 * 2. 所有能力统一通过 api.services.xxx() 提供
 * 3. ExtensionApi 成为 Extension 与主进程交互的唯一边界
 */
export interface ExtensionServices {
  /** HITL 审批服务 */
  hitl: {
    /** 等待单个工具调用的审批决策 */
    waitForSingleDecision(
      approvalId: string,
      timeoutMs?: number
    ): Promise<import('@shared/stream-protocol').HitlApprovalDecision | null>;
    /** 提交单个工具调用的审批决策 */
    submitSingleDecision(approvalId: string, decision: import('@shared/stream-protocol').HitlApprovalDecision): boolean;
    /** 清理指定 session 的所有审批 */
    cleanupSession(sessionId: string): void;
  };
  /** 路径解析服务 */
  paths: {
    /** 获取 Agent 工作空间目录 */
    getWorkspace(sessionId: string): Promise<string>;
    /** 获取 Agent Home 目录 */
    getAgentHome(agentId: string): Promise<string>;
    /** 获取用户主目录 */
    getUserHome(): Promise<string>;
    /** 获取全局数据目录（用于扩展存储） */
    getDataDir(extensionId: string): Promise<string>;
    /** 获取配置目录 */
    getConfigDir(): Promise<string>;
    /** 获取 secrets 目录 */
    getSecretsDir(): Promise<string>;
    /** 获取工作空间根目录 */
    getWorkspacesDir(): Promise<string>;
  };
  /** LLM 调用服务 */
  llm: {
    /** 调用 LLM 进行对话（使用默认模型） */
    chat(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>): Promise<string>;
    /**
     * 通过指定 Agent 执行一次对话
     *
     * 系统自动加载该 Agent 的 instructions/model 等配置，
     * 走 AgentExecutor 正路（lightweight chat 模式）。
     * @param agentId Agent ID（如 'memory-analyzer'）
     * @param message 用户输入内容
     */
    runAgent(agentId: string, message: string): Promise<string>;
    /** 生成文本的 embedding 向量 */
    embed(texts: string[], options?: { model?: string }): Promise<number[][]>;
  };
  /** Agent 相关服务 */
  agent: {
    /** 获取 AgentExecutor 实例 */
    getExecutor(): Promise<ReturnType<typeof import('../agent/AgentExecutor').getAgentExecutor>>;
    /** 获取 AgentStore 实例 */
    getStore(): Promise<import('../agent/agents/AgentStore').AgentStore>;
    /** 获取内置工具列表 */
    getBuiltinTools(): Promise<Array<import('../agent/tools/types').ToolDefinition>>;
    /** 获取 ToolRegistry 实例 */
    getToolRegistry(): Promise<import('../agent/tools/registry').ToolRegistry>;
    /** 获取 SkillManager 实例 */
    getSkillManager(): Promise<import('../agent/skills').SkillManager>;
  };
  /** Thread 相关服务 */
  thread: {
    /** 获取 ThreadStore 实例 */
    getStore(): Promise<import('../agent/threads/ThreadStore').ThreadStore>;
  };
}

/** Extension 与系统交互的唯一接口 */
export interface ExtensionApi {
  /** Extension ID */
  id: string;
  /** Extension 名称 */
  name: string;
  /** 来源 */
  origin: ExtensionOrigin;
  /** 日志 */
  logger: ExtensionLogger;

  /**
   * 核心服务接口（解耦 Extension 与核心模块的直接依赖）
   *
   * Extension 应通过 api.services 访问 HITL、路径、LLM 等能力，
   * 而非直接 import 内部模块路径。
   */
  services: ExtensionServices;

  /**
   * EventBus 接口（延迟加载）
   *
   * 避免 Extension 直接 import eventbus，防止触发 env/logger 初始化链。
   */
  eventBus: ExtensionEventBus;

  /** 注册工具 */
  registerTool(tool: ToolDefinition): void;
  /** 注册 Agent 生命周期钩子 */
  on<K extends ExtensionHookName>(hookName: K, handler: ExtensionHookHandler<K>, opts?: { priority?: number }): void;
  /** 注册 Gateway RPC 方法 */
  registerGatewayMethod(method: string, handler: MethodHandler): void;

  /** 注册 HTTP 路由 */
  registerHttpRoute(config: HttpRouteConfig): void;
  /** 注册后台服务 */
  registerService(service: BackgroundService): void;
  /** 注册定时任务（通过 CronScheduler 调度） */
  registerCronJob(config: CronJobConfig): void;
}

// ==================== Extension Hook ====================

/** 扩展点分类 */
export type ExtensionHookCategory = 'event' | 'interceptor';

/** 执行模式 */
export type ExtensionHookMode = 'void' | 'modifying';

/**
 * 公开扩展点统一定义入口
 *
 * 单一来源：所有扩展点名字、分类、执行模式都从这里定义。
 * 其他类型（ExtensionHookName / AgentEventName / AgentInterceptorName）都基于它推导。
 */
export const EXTENSION_HOOK_DEFINITIONS = {
  prepare_run_input: { category: 'interceptor', mode: 'modifying' },
  prepare_tool_call: { category: 'interceptor', mode: 'modifying' },
  transform_tool_result: { category: 'interceptor', mode: 'modifying' },
  message_received: { category: 'event', mode: 'void' },
  run_started: { category: 'event', mode: 'void' },
  run_completed: { category: 'event', mode: 'void' },
  turn_started: { category: 'event', mode: 'void' },
  turn_completed: { category: 'event', mode: 'void' },
  tool_call_completed: { category: 'event', mode: 'void' },
  compaction_started: { category: 'event', mode: 'void' },
  compaction_completed: { category: 'event', mode: 'void' }
} as const satisfies Record<string, { category: ExtensionHookCategory; mode: ExtensionHookMode }>;

/** 公开扩展点名称 */
export type ExtensionHookName = keyof typeof EXTENSION_HOOK_DEFINITIONS;

/** 单个扩展点定义 */
export type ExtensionHookDefinition = (typeof EXTENSION_HOOK_DEFINITIONS)[ExtensionHookName];

type HookNamesByCategory<C extends ExtensionHookCategory> = {
  [K in ExtensionHookName]: (typeof EXTENSION_HOOK_DEFINITIONS)[K]['category'] extends C ? K : never;
}[ExtensionHookName];

/** Agent 运行时公开事件（只读通知） */
export type AgentEventName = HookNamesByCategory<'event'>;

/** Agent 运行时公开拦截点（可修改） */
export type AgentInterceptorName = HookNamesByCategory<'interceptor'>;

/** 兼容导出：按名称查看执行模式 */
export const EXTENSION_HOOK_MODE: Record<ExtensionHookName, ExtensionHookMode> = {
  prepare_run_input: EXTENSION_HOOK_DEFINITIONS.prepare_run_input.mode,
  prepare_tool_call: EXTENSION_HOOK_DEFINITIONS.prepare_tool_call.mode,
  transform_tool_result: EXTENSION_HOOK_DEFINITIONS.transform_tool_result.mode,
  message_received: EXTENSION_HOOK_DEFINITIONS.message_received.mode,
  run_started: EXTENSION_HOOK_DEFINITIONS.run_started.mode,
  run_completed: EXTENSION_HOOK_DEFINITIONS.run_completed.mode,
  turn_started: EXTENSION_HOOK_DEFINITIONS.turn_started.mode,
  turn_completed: EXTENSION_HOOK_DEFINITIONS.turn_completed.mode,
  tool_call_completed: EXTENSION_HOOK_DEFINITIONS.tool_call_completed.mode,
  compaction_started: EXTENSION_HOOK_DEFINITIONS.compaction_started.mode,
  compaction_completed: EXTENSION_HOOK_DEFINITIONS.compaction_completed.mode
};

// ---- 各 Hook 的 Event / Result ----

export interface PrepareRunInputEvent {
  sessionId: string;
  prompt: string;
  systemPrompt?: string;
}
export interface PrepareRunInputResult {
  prependContext?: string;
  replaceSystemPrompt?: string;
}

export interface PrepareToolCallEvent {
  sessionId: string;
  toolName: string;
  params: Record<string, unknown>;
  /** 工具定义中是否标记需要用户确认（needUserConfirm） */
  needUserConfirm?: boolean;
}
export interface PrepareToolCallResult {
  block?: boolean;
  blockReason?: string;
  /** 异步挂起：工具需要审批但不阻塞 Agent run，run 正常结束后等待事件唤醒 */
  suspend?: boolean;
  suspendReason?: string;
  /** 自定义结果文本（用于 suspend 或 block 时的消息） */
  resultText?: string;
  params?: Record<string, unknown>;
}

export interface TransformToolResultEvent {
  sessionId: string;
  toolName: string;
  result: string;
}
export interface TransformToolResultResult {
  result?: string;
}

export interface RunCompletedEvent {
  sessionId: string;
  agentId: string;
  success: boolean;
  output: string;
  durationMs: number;
}

export interface ToolCallCompletedEvent {
  sessionId: string;
  toolName: string;
  params: Record<string, unknown>;
  result: string;
  durationMs: number;
}

export interface MessageReceivedEvent {
  sessionId: string;
  message: string;
}

export interface RunStartedEvent {
  sessionId: string;
}

export interface TurnStartedEvent {
  sessionId: string;
  /** 轮次索引（从 1 开始） */
  turnIndex: number;
}

export interface TurnCompletedEvent {
  sessionId: string;
  /** 轮次索引 */
  turnIndex: number;
  /** 本轮耗时（ms） */
  durationMs: number;
  /** 本轮工具调用次数 */
  toolCallCount: number;
  /** 本轮 token 用量（如果底层 Runtime 提供） */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface CompactionStartedEvent {
  sessionId: string;
  /** Agent 定义 ID（用于定位 Agent Home） */
  agentId?: string;
  /** 待压缩消息数 */
  messageCount: number;
  /** 当前 token 总数 */
  totalTokens: number;
  /** 触发阈值 */
  threshold: number;
}

export interface CompactionCompletedEvent {
  sessionId: string;
  /** 压缩前 token 数 */
  originalTokens: number;
  /** 压缩后 token 数 */
  compressedTokens: number;
  /** 压缩比 */
  compressionRatio: number;
  /** 压缩耗时（ms） */
  durationMs: number;
}

/** Event 映射 */
export type ExtensionHookEventMap = {
  prepare_run_input: PrepareRunInputEvent;
  prepare_tool_call: PrepareToolCallEvent;
  transform_tool_result: TransformToolResultEvent;
  message_received: MessageReceivedEvent;
  run_started: RunStartedEvent;
  run_completed: RunCompletedEvent;
  turn_started: TurnStartedEvent;
  turn_completed: TurnCompletedEvent;
  tool_call_completed: ToolCallCompletedEvent;
  compaction_started: CompactionStartedEvent;
  compaction_completed: CompactionCompletedEvent;
};

/** Result 映射 */
export type ExtensionHookResultMap = {
  prepare_run_input: PrepareRunInputResult | void;
  prepare_tool_call: PrepareToolCallResult | void;
  transform_tool_result: TransformToolResultResult | void;
  message_received: void;
  run_started: void;
  run_completed: void;
  turn_started: void;
  turn_completed: void;
  tool_call_completed: void;
  compaction_started: void;
  compaction_completed: void;
};

/** Handler 签名 */
export type ExtensionHookHandler<K extends ExtensionHookName> = (
  event: ExtensionHookEventMap[K]
) => Promise<ExtensionHookResultMap[K]>;

/** 已注册的 Hook */
export interface RegisteredExtensionHook<K extends ExtensionHookName = ExtensionHookName> {
  extensionId: string;
  hookName: K;
  handler: ExtensionHookHandler<K>;
  priority: number;
}

// ==================== 注册记录 ====================

export interface RegisteredExtensionTool {
  extensionId: string;
  tool: ToolDefinition;
}

export interface RegisteredExtensionMethod {
  extensionId: string;
  method: string;
  handler: MethodHandler;
}

/** 扩展贡献的 Skill 目录 */
export interface RegisteredExtensionSkillDir {
  extensionId: string;
  /** 已解析为绝对路径的 Skill 目录 */
  dir: string;
}

export interface RegisteredHttpRoute {
  extensionId: string;
  route: HttpRouteConfig;
}

export interface RegisteredBackgroundService {
  extensionId: string;
  service: BackgroundService;
}

// ==================== CronJob ====================

/** Extension 注册定时任务的配置 */
export interface CronJobConfig {
  /** 任务名称（英文标识符，同一 Extension 内不能重复） */
  name: string;
  /** 任务描述 */
  description: string;
  /** Cron 表达式（5 段标准格式：分 时 日 月 周） */
  cronExpression: string;
  /** 要执行的任务（自然语言描述，交给 Agent 执行） */
  task: string;
  /** 关联的 Agent ID（可选，默认使用 app-copilot） */
  agentId?: string;
  /** 是否启用（默认 true） */
  enabled?: boolean;
}

export interface RegisteredCronJob {
  extensionId: string;
  config: CronJobConfig;
}
