/**
 * runtime 层统一类型定义
 *
 * 这个文件只定义 runtime 这一层自己的公共契约，目标是把“如何运行一个 Agent”
 * 抽象成稳定、SDK 无关的接口与数据结构。
 *
 * 可以把这里的类型分成四组来理解：
 *   1. 运行计划：`RuntimeBuilderRequest`
 *      - 描述“上层想运行一个什么样的 Agent”
 *      - 用于 builder / factory 选择与组装
 *   2. 运行时快照：`AgentRuntimeOptions`
 *      - 描述“一个 runtime 实例最终拿到的只读配置”
 *      - 用于调试、日志、快照记录
 *   3. 执行交互：`ExecutionConfig` / `ExecutionResult`
 *      - 描述“本次调用如何执行、最终返回什么”
 *   4. 流式协议：`StreamChunk` / `StreamChunkType`
 *      - 描述“执行过程中如何持续向外发事件”
 *
 * 设计原则：
 *   1. SDK 无关：不依赖某一套具体 SDK 的原生对象
 *   2. 运行优先：聚焦运行期契约，不把 builder 工厂逻辑揉进来
 *   3. 单向分层：上层依赖这里；这里不反向依赖入口层或业务层
 */

// ========== 统一工具定义 ==========

/**
 * 从 tools/types.ts 统一导出工具类型
 *
 * 工具类型的权威来源在 src/main/ai/tools/types.ts，
 * 此处 re-export 保持 Runtime 层的向后兼容。
 */
import type { ToolDefinition as _ToolDefinition } from '../tools/types';
export type {
  ToolCategory,
  ToolError,
  ToolResult,
  ToolResultMetadata,
  ToolStreamUpdate,
  ToolExecutionContext,
  ToolDefinition
} from '../tools/types';

// 文件内使用的别名（re-export 的类型在同文件不可直接引用）
type ToolDefinition = _ToolDefinition;

// ========== 统一技能定义 ==========

/**
 * 统一技能定义（SDK 无关）
 *
 * Skill 是运行时可消费的知识与指令单元。
 * runtime 层只关心“有哪些 skill、如何在提示词或资源加载阶段引用它们”，
 * 不关心它们是从本地目录、扩展系统还是数据库里来的。
 *
 * 各 runtime 的注入方式可以不同：
 *   - OpenAI：通常会被格式化后拼进最终 instructions
 *   - PiMono：通常通过 resourceLoader 暴露给 SDK，由 SDK 内部决定何时加载
 */
/**
 * Skill 配置项描述（定义在 SKILL.md frontmatter 的 config 字段中）
 *
 * 告诉 Agent 该 Skill 需要哪些配置，Agent 可据此帮用户填写 skills.json5。
 */
export interface SkillConfigField {
  /** 配置项键名 */
  key: string;
  /** 配置项描述 */
  description: string;
  /** 是否必填 */
  required?: boolean;
  /** 默认值 */
  default?: unknown;
}

export interface SkillDefinition {
  /** 技能名称（唯一标识） */
  name: string;
  /** 技能描述（用于提示词中的标注） */
  description: string;
  /** 技能内容（通常是 markdown 格式的指令/知识） */
  content: string;
  /** SKILL.md 文件的绝对路径（用于按需读取） */
  filePath?: string;
  /** Skill 所需配置项描述（来自 SKILL.md frontmatter） */
  configSchema?: SkillConfigField[];
  /** 运行时注入的配置值（来自 skills.json5，不含敏感信息的摘要供 prompt 使用） */
  configStatus?: 'configured' | 'missing' | 'partial';
}

// ========== 运行模式 ==========

/**
 * Agent 运行模式
 *
 * 这里的 mode 描述的是“这次运行想要多强的 Agent 能力”，
 * 而不是底层具体用哪套 SDK。
 *
 *   - chat:
 *       纯对话模式。尽量少注入工具、协议和 skill，强调轻量与直接回复。
 *   - agent:
 *       完整 Agent 模式。允许工具、执行协议、skills、HITL 等完整能力进入运行时。
 *
 * mode 一般先出现在 builder 请求里，后续由环境装配层决定要注入哪些能力。
 */
export type AgentMode = 'chat' | 'agent';

// ========== Runtime 选择与 Builder 请求 ==========

/**
 * Runtime 实现类型
 *
 * 这是“底层实现选型”维度，回答的是：
 *   - 这次最终由哪个 runtime 实现来承接？
 *
 * 它和 `AgentMode` 不同：
 *   - `AgentMode` 决定能力语义（chat / agent）
 *   - `RuntimeKind` 决定实现类型（pimono / openai / claude）
 *
 * 入口层通常不应该直接 `new` 具体 Builder，而应把这层选择收口到 runtime 工厂里。
 */
export type RuntimeKind = 'pimono' | 'openai' | 'claude';

/**
 * 会话持久化语义
 *
 * 这是“运行状态保留多久”的抽象表达，避免上层直接依赖某个 runtime
 * 特有的 `sessionMode=file|memory` 之类实现细节。
 *
 *   - memory:
 *       状态只保留在当前进程 / 当前调用上下文中，适合一次性调用
 *   - thread:
 *       状态绑定到某个 thread / session，可跨多轮继续执行
 */
export type RuntimePersistence = 'memory' | 'thread';

/**
 * Runtime Builder 创建请求
 *
 * 这是 runtime 层最重要的“入口请求”对象之一。
 * 它描述的是运行意图，而不是某个具体 SDK 的原生配置。
 *
 * 可以把它理解成：
 *   “请帮我创建一个能满足这些运行语义的 builder / runtime 计划”
 *
 * 典型流程：
 *   入口层 / launcher 组装 `RuntimeBuilderRequest`
 *     -> runtime factory 选择具体 builder
 *     -> 环境装配层补齐 workspace / session / tools / skills
 *     -> build 成真正的 `AgentRuntime`
 */
export interface RuntimeBuilderRequest {
  /** 指定 Runtime 类型；不传则走 runtime 层默认策略 */
  runtime?: RuntimeKind;
  /** 运行模式（默认 agent） */
  mode?: AgentMode;
  /** 会话持久化语义（默认 memory） */
  persistence?: RuntimePersistence;
  /** Agent 定义 ID */
  agentId?: string;
  /** 运行时展示名称 */
  name?: string;
  /** 运行时基础指令 */
  instructions?: string;
  /** 会话 ID */
  sessionId?: string;
  /** 会话目录 */
  sessionDir?: string;
  /** 工作区根目录 */
  workspaceRoot?: string;
  /** 上下文快照目录 */
  contextDir?: string;
  /** 最大轮次 */
  maxTurns?: number;
  /** 任务级模型覆盖 */
  modelOverride?: string;
}

// ========== Agent 运行时身份 ==========

/**
 * AgentRuntime 实例对外声明的运行时类型
 *
 * 这是 runtime 实例最终对外暴露的实现身份。
 * 和 `RuntimeKind` 的区别可以简单理解为：
 *   - `RuntimeKind`：用于“创建前/创建中”的选型
 *   - `AgentRuntimeKind`：用于“创建后”的实例身份标识
 *
 * 当前两者的取值几乎一一对应，但语义阶段不同，所以仍然分别保留。
 */
export type AgentRuntimeKind = 'pi-mono' | 'openai' | 'claude';

/**
 * 思考级别
 *
 * 控制 LLM 的思考深度（与 pi-ai SDK ThinkingLevel 一致）：
 *   - minimal: 最少思考
 *   - low: 简单思考
 *   - medium: 中等思考（默认）
 *   - high: 深度思考
 *   - xhigh: 极深度思考
 */
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

// ========== 压缩配置 ==========

/**
 * Session 压缩配置（SDK 无关）
 *
 * 当对话历史的 token 数超过 contextWindowSize * thresholdRatio 时，
 * 触发自动压缩：将旧消息总结后保留最近消息。
 */
export interface CompactionConfig {
  /** 是否启用压缩（默认 false） */
  enabled?: boolean;
  /** 上下文窗口大小（token 数，默认 128000） */
  contextWindowSize?: number;
  /** 触发压缩的阈值比例（默认 0.7，即达到上下文窗口的 70% 时触发） */
  thresholdRatio?: number;
  /** 保留最近消息的比例（默认 0.3） */
  keepRatio?: number;
  /** 触发压缩的最小消息数（默认 10） */
  minMessageCount?: number;
  /** 是否调试模式 */
  debug?: boolean;
}

// ========== Agent 运行时通用选项 ==========

/**
 * AgentRuntime 基础选项（SDK 无关）
 *
 * 这是“一个 runtime 实例最终拿到的配置快照”。
 * 它不是入口层给用户暴露的请求 DTO，也不是 builder 工厂的全部参数。
 *
 * 更直白一点：
 *   - `RuntimeBuilderRequest` 偏“我要什么”
 *   - `AgentRuntimeOptions` 偏“这个 runtime 最终拿到了什么”
 *
 * 这份配置会被运行时、日志、快照、调试代码反复使用，所以保持只读、稳定很重要。
 * 各 SDK 具体实现可以在此基础上继续扩展。
 */
export interface AgentRuntimeOptions {
  /** Agent 名称 */
  name: string;

  /** 运行时实例类型 */
  type: AgentRuntimeKind;

  /** Agent 基础系统指令 */
  instructions: string;

  /**
   * 追加指令片段
   *
   * 在基础 instructions 之后追加的额外指令。
   * 适合动态注入上下文信息（如当前项目结构、用户偏好等）。
   */
  appendInstructions?: string[];
  /**
   * 技能列表
   *
   * 注入到系统提示词中的领域知识。
   * 各 Runtime 自动格式化并整合到最终 LLM 上下文中。
   */
  skills?: SkillDefinition[];

  /** 会话 ID（不传则自动生成） */
  sessionId?: string;

  /**
   * Session 持久化模式
   *
   * - 'memory': 内存模式（默认，适合测试）
   * - 'file': 文件模式（持久化到 cwd/.pi/sessions/）
   */
  sessionMode: 'memory' | 'file';

  /**
   * 会话存储根目录
   *
   * 各 Runtime 在此目录下以 sessionId 建立子目录存放会话文件。
   * 不传则由 Executor 层注入 Electron userData 默认路径。
   *
   * 示例：
   *   sessionDir = '~/Library/Application Support/coobee-ai/sessions'
   *   → OpenAI: {sessionDir}/{sessionId}/messages.jsonl
   *   → PiMono: {sessionDir}/{sessionId}/（SDK 自行管理内部结构）
   */
  sessionDir: string;

  /** 最大执行轮次，防止无限工具调用循环（默认 25） */
  maxTurns?: number;
  /**
   * 上下文快照目录
   *
   * 如果设置，Runtime 在每次 LLM 调用完成后会将输入配置和输出结果
   * 以 JSON 文件写入此目录，用于调试和 Prompt 优化。
   *
   * 文件命名格式：{ISO 时间戳}.json（自然排序 = 时间顺序）
   * 由 AgentEnvInjector.prepareAgentEnv() 准备为 {workspace}/contexts/
   */
  contextDir?: string;
  /**
   * 工作区根目录
   *
   * 所有文件工具（read/write/edit）的路径边界，exec 命令的工作目录。
   * 由 AgentEnvInjector.prepareAgentEnv() 准备为 Agent 的 workspace 目录。
   * 不传则降级为 process.cwd()。
   */
  workspaceRoot?: string;
  /**
   * 统一工具列表（SDK 无关）
   *
   * 使用 ToolDefinition 格式定义工具，Runtime 内部自动转换为 SDK 原生格式。
   * 与 SDK 原生工具（各 Runtime 的 sdkTools）共存，SDK 原生工具优先。
   */
  tools?: ToolDefinition[];
  /**
   * 工具执行上下文
   *
   * 由 AgentEnvInjector 通过 Builder 注入。
   * 包含沙箱信息（路径守卫、策略检查）+ Agent/Session 信息。
   * 不传则降级为 path-only + workspaceRoot。
   */
  sandboxContext?: import('../tools/types').ToolExecutionContext;

  /** 取消信号 */
  signal?: AbortSignal;

  /** 提供商名称 */
  provider: string;

  /** 模型名称；如果构建阶段有 provider/model override，最终结果会体现在这里 */
  model: string;

  /** API Key（运行时注入，OpenAI 格式的 Bearer token） */
  apiKey: string;

  /** API 格式 */
  apiType: 'openai-compatible' | 'anthropic';

  /**
   * OpenAI 兼容 API 的 Base URL（由 Builder / 调用方解析后注入）
   *
   * 所有后端统一使用 OpenAI Chat Completions 格式，例如 MiniMax、DeepSeek、OpenAI 等端点。
   */
  baseURL: string;

  /** 思考级别（默认 'medium'） */
  thinkingLevel: ThinkingLevel;

  /**
   * 压缩配置
   *
   * 当对话历史超过 contextWindowSize * thresholdRatio 时触发自动压缩。
   * enabled=false 时禁用自动压缩。
   */
  compaction: CompactionConfig;

  /**
   * 模型元数据（从 coobee.json5 模型配置透传）
   *
   * 用于动态构造 pi-SDK Model 对象。由 AgentRuntimeBuilder.build() 从 ProviderConfig 中提取并注入。
   */
  modelMeta: {
    /** 模型是否支持推理模式（控制 SDK 是否解析 reasoning_content） */
    reasoning?: boolean;
    /** 上下文窗口大小（token 数） */
    contextWindow?: number;
    /** 最大输出 token 数 */
    maxOutputTokens?: number;
    /** 最大推理思考 token 数 */
    maxThinkingTokens?: number;
    /** 模型是否支持工具调用（Function Calling） */
    functionCalling?: boolean;
  };

  /**
   * 重试配置
   *
   * SDK 内置自动重试，通过 SettingsManager 配置。
   */
  retry?: { enabled?: boolean; maxRetries?: number; baseDelayMs?: number };
}

// ========== 系统提示词构建 ==========

/**
 * 格式化技能列表为提示词文本
 *
 * 这是 runtime 层对 skill 的一个保守默认策略：
 *   - 默认只注入 skill 摘要，避免把大量 SKILL.md 内容一次性塞进上下文
 *   - 当确实需要完整内容时，再切到 `full`
 *
 * 摘要模式下只注入：
 *   - `name`
 *   - `description`
 *   - `filePath`
 *
 * 这样模型可以先“知道有这个 skill”，需要时再通过工具按需读取完整内容。
 */
export function formatSkills(skills: SkillDefinition[], mode: 'summary' | 'full' = 'summary'): string {
  if (!skills.length) return '';
  const items = skills
    .map((s) => {
      if (mode === 'full') {
        return `<skill name="${s.name}">\n<description>${s.description}</description>\n<content>\n${s.content}\n</content>\n</skill>`;
      }
      const pathAttr = s.filePath ? ` path="${s.filePath}"` : '';
      return `<skill name="${s.name}"${pathAttr}>\n${s.description}\n</skill>`;
    })
    .join('\n');

  const hint =
    mode === 'summary'
      ? '\n<!-- To use a skill, read its SKILL.md file with the read tool for full instructions. -->'
      : '';
  return `<skills>${hint}\n${items}\n</skills>`;
}

/**
 * 构建最终系统提示词
 *
 * 这是“不具备独立 skill/resource 装配能力”的 runtime 的默认拼装策略。
 * 目前典型用法是 OpenAI 路线：把基础 instructions、skills 摘要、appendInstructions
 * 合并成一段最终系统提示词。
 *
 * 组装顺序固定为：
 *   instructions -> skills -> appendInstructions
 *
 * 具备更强资源装配能力的 runtime（例如 PiMono）可以不依赖这个函数。
 */
export function buildInstructions(
  instructions: string,
  skills?: SkillDefinition[],
  appendInstructions?: string[]
): string {
  const parts: string[] = [instructions];

  if (skills?.length) {
    parts.push(formatSkills(skills));
  }

  if (appendInstructions?.length) {
    parts.push(appendInstructions.join('\n\n'));
  }

  return parts.join('\n\n');
}

// ========== 执行配置和结果 ==========

/**
 * 执行配置（单次调用覆盖项）
 *
 * 这组参数的生命周期仅限“一次 `stream()` / `run()` 调用”。
 * 它们用于在不改变 runtime 基础配置的前提下，对本次执行做局部覆盖。
 */
export interface ExecutionConfig {
  /** 是否启用流式输出 */
  streaming?: boolean;
  /** 覆盖最大轮次 */
  maxTurns?: number;
  /** 取消信号 */
  signal?: AbortSignal;
}

/**
 * 工具审批信息（前端可读格式）
 */
export interface ToolApprovalInfo {
  /** 审批项索引 */
  index: number;
  /** 工具名称 */
  toolName: string;
  /** 工具参数（JSON 字符串） */
  arguments: string;
}

/**
 * 执行结果
 *
 * 这是一次完整执行完成后返回给上层的稳定结果对象。
 * 它和 `StreamChunk` 的关系是：
 *   - `StreamChunk` 负责过程事件
 *   - `ExecutionResult` 负责最终归档结果
 */
export interface ExecutionResult {
  /** 最终输出文本 */
  output: string;
  /** API 错误信息（SDK 内部错误，非 throw 类型） */
  error?: string;
  /** 是否被中断（HITL 工具审批） */
  interrupted?: boolean;
  /** 待审批的工具调用列表（仅 interrupted=true 时有值） */
  interruptions?: ToolApprovalInfo[];
  /** 使用的工具调用记录 */
  toolCalls?: Array<{
    toolName: string;
    arguments: Record<string, unknown>;
    result?: unknown;
  }>;
  /** 执行耗时（ms） */
  duration?: number;
  /** 元数据 */
  metadata?: Record<string, unknown>;
  /** 原始 API 请求体（用于调试和审计） */
  rawApiRequest?: {
    model: string;
    messages: Array<{ role: string; content: string | unknown }>;
    tools?: Array<unknown>;
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
    [key: string]: unknown;
  };
}

// ========== 流式事件 ==========

/**
 * 流式输出块
 *
 * 这是 runtime 层对外唯一的流式事件载体。
 * 不管底层是 OpenAI、PiMono，还是以后新增 runtime，只要要进入统一执行链，
 * 最终都应该翻译成 `StreamChunk`。
 *
 * 消费方通常只依赖两件事：
 *   - `type`：事件类别
 *   - `data`：该类别对应的结构化数据
 */
export interface StreamChunk {
  /** 事件类型（prefix:event 格式） */
  type: StreamChunkType;
  /** 主要内容（文本增量、工具名、错误信息等） */
  content: string;
  /** 额外数据（类型随 type 变化） */
  data?: StreamChunkData;
  /** 发出此事件的 Agent 名称（多 Agent 场景有值） */
  agentName?: string;
}

/**
 * 流式事件类型
 *
 * 命名约定统一为 `domain:event`，例如：
 *   - `run:start`
 *   - `tool:done`
 *   - `compression:done`
 *
 * 设计目标有三个：
 *   1. 读名字就知道层级归属
 *   2. 同一类事件尽量形成完整闭环
 *   3. 上层消费者不需要了解底层 SDK 的事件模型
 *
 * 一般层级关系可以理解为：
 *   run
 *     -> turn
 *       -> llm
 *         -> text / reasoning / tool
 *
 * 注意：
 *   - 并不是每个 runtime 都会产出所有事件
 *   - 也不是每种事件都严格满足 start/delta/done 三段式
 *   - 但统一命名能让消费侧保持稳定
 */
export type StreamChunkType =
  // ① run: 执行生命周期（最外层）
  | 'run:start' // 整个执行开始
  | 'run:done' // 整个执行完成
  | 'run:error' // 执行错误
  | 'run:interrupted' // 被 HITL 中断
  | 'run:resumed' // 恢复执行
  // ② turn: 对话轮次（一轮 = 一次 LLM 调用 + 可能的工具执行）
  | 'turn:start' // 轮次开始
  | 'turn:done' // 轮次完成
  // ③ llm: 模型 API 调用
  | 'llm:start' // 模型调用开始
  | 'llm:done' // 模型调用完成
  // ④ text: 文本输出
  | 'text:start' // 文本开始
  | 'text:delta' // 文本增量
  | 'text:done' // 文本完成
  // ⑤ reasoning: 推理/思维链
  | 'reasoning:start' // 推理开始
  | 'reasoning:delta' // 推理增量
  | 'reasoning:done' // 推理完成
  // ⑥ tool: 工具调用
  | 'tool:start' // 工具调用开始
  | 'tool:delta' // 参数增量 / 执行进度
  | 'tool:pending' // 参数完成，等待执行
  | 'tool:done' // 执行完成
  // ⑦ handoff: Agent 切换
  | 'handoff:start' // 请求切换
  | 'handoff:done' // 切换完成
  // ⑦.5 agent: Agent 运行期状态
  | 'agent:updated' // SDK 当前 Agent 已切换或更新
  // ⑧ compression: Session 压缩
  | 'compression:start' // 压缩开始
  | 'compression:done' // 压缩完成（含统计信息）
  // ⑨ delegate: 子 Agent 委托
  | 'delegate:start' // 委托开始
  | 'delegate:done' // 委托完成
  // ⑪ quality: 质量循环
  | 'quality:round_start' // 验证轮开始
  | 'quality:validating' // 正在验证
  | 'quality:score' // 验证评分
  | 'quality:repairing' // 正在修复
  | 'quality:done'; // 质量循环完成

/**
 * StreamChunk 额外数据
 *
 * `data` 的具体结构由 `type` 决定。
 * 这里保持宽联合而不是强绑定映射，是为了让不同 runtime 在逐步收敛协议时
 * 仍然能安全演进。
 */
export type StreamChunkData =
  | RunErrorData
  | TurnData
  | LlmDoneData
  | TextDeltaData
  | TextDoneData
  | ReasoningDoneData
  | ToolStartData
  | ToolDeltaData
  | ToolPendingData
  | ToolDoneData
  | HandoffData
  | CompressionStartData
  | CompressionDoneData
  | Record<string, unknown>;

// ---- ① run: ----

/** run:error 数据 */
export interface RunErrorData {
  /** 错误消息 */
  message: string;
  /** 错误码 */
  code?: string;
}

// ---- ② turn: ----

/** turn:start / turn:done 数据 */
export interface TurnData {
  /** 轮次索引（从 1 开始） */
  turnIndex: number;
}

// ---- ③ llm: ----

/** llm:done 数据（含 token 用量） */
export interface LlmDoneData {
  /** 响应 ID */
  responseId?: string;
  /** Token 用量 */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

// ---- ④ text: ----

/** text:delta 数据 */
export interface TextDeltaData {
  /** 增量文本片段 */
  delta: string;
}

/** text:done 数据 */
export interface TextDoneData {
  /** 完整文本 */
  text: string;
}

// ---- ⑤ reasoning: ----

/** reasoning:done 数据 */
export interface ReasoningDoneData {
  /** 推理摘要（用户可见） */
  summary?: string;
  /** 原始推理文本（可能不返回） */
  rawContent?: string;
}

// ---- ⑥ tool: ----

/** tool:start 数据 */
export interface ToolStartData {
  /** 工具名称 */
  toolName: string;
  /** 调用 ID */
  callId?: string;
  /** 工具参数（如果 runtime 在 start 阶段可获得） */
  arguments?: unknown;
}

/** tool:delta 数据 */
export interface ToolDeltaData {
  /** 参数 JSON 片段 / 执行进度 */
  delta: string;
  /** 调用 ID */
  callId?: string;
}

/** tool:pending 数据（参数完成） */
export interface ToolPendingData {
  /** 工具名称 */
  toolName?: string;
  /** 调用 ID */
  callId?: string;
  /** 完整参数 JSON 字符串 */
  arguments: string;
}

/** tool:done 数据（执行结果） */
export interface ToolDoneData {
  /** 工具名称 */
  toolName: string;
  /** 调用 ID */
  callId?: string;
  /** 输出内容 */
  output: unknown;
  /** 工具参数（部分 runtime 只在完成事件中可获得） */
  toolArgs?: unknown;
}

// ---- ⑦ handoff: ----

/** handoff:start / handoff:done 数据 */
export interface HandoffData {
  /** 来源 Agent 名称 */
  fromAgent?: string;
  /** 目标 Agent 名称 */
  toAgent: string;
}

// ---- ⑧ compression: ----

/** compression:start 数据 */
export interface CompressionStartData {
  /** 触发原因 */
  reason: string;
  /** 当前 token 数 */
  totalTokens: number;
  /** 阈值 */
  threshold: number;
}

/** compression:done 数据 */
export interface CompressionDoneData {
  /** 被压缩的消息序号列表 */
  summarizedSeqs: number[];
  /** 最后一个被压缩的序号 */
  endSeq: number;
  /** 压缩前的 token 数 */
  originalTokens: number;
  /** 总结的 token 数 */
  summaryTokens: number;
  /** 压缩比 */
  compressionRatio: number;
  /** 压缩耗时（ms） */
  duration: number;
}

// ========== 会话信息 ==========

/**
 * 会话信息
 *
 * 这是 runtime 层对 session 元信息的轻量抽象，不承诺暴露底层 SDK 的完整 session 对象。
 */
export interface SessionInfo {
  /** 会话 ID */
  sessionId: string;
  /** 创建时间 */
  createdAt: number;
  /** 最后更新时间 */
  updatedAt: number;
  /** 消息数量 */
  messageCount: number;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}
