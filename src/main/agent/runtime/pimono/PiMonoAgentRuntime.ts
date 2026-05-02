/**
 * Pi-Mono Agent 运行时
 *
 * 基于 pi-coding-agent SDK 的 AgentRuntime 实现。
 *
 * 核心能力：
 * - 单智能体模式：createAgentSession() 创建 AgentSession
 * - 四层事件体系：agent > turn > message > tool，SDK 直接提供 turn 边界
 * - 独立思考流：thinking_delta 独立于 text_delta，无需解析 <think> 标签
 * - 工具执行进度：tool_execution_update 提供实时进度
 * - 内置压缩/重试：SDK 自动管理
 * - 单通道事件分发：onChunk → yield → AgentExecutor.forward() 统一广播
 *
 * API 格式：
 * - 统一使用 OpenAI Chat Completions 格式（openai-completions）
 * - 通过 baseURL 指向不同的 OpenAI 兼容服务端点
 * - 不依赖 Anthropic SDK，不使用 ANTHROPIC_AUTH_TOKEN
 *
 * 与 OpenAI 实现的关键差异：
 * - Turn 边界由 SDK 直接给出（无需从 response_started 推断）
 * - 思考内容通过 thinking_delta 独立传递（无需解析 <think> 标签）
 * - 工具执行有进度事件（tool_execution_update）
 * - 会话/压缩/重试全部由 SDK 内置管理
 *
 * 模块拆分：
 * - PiMonoToolConverter.ts  — 工具转换（ToolDefinition → PiToolDefinition）
 * - PiMonoStreamAdapter.ts  — 流式事件适配（AgentSessionEvent → AgentStreamChunk）
 * - ChunkQueue.ts           — 推送→拉取桥接器
 * - types.ts                — 类型定义
 */

import type { Model } from '@mariozechner/pi-ai';
import type {
  AgentSession,
  CreateAgentSessionOptions,
  ToolDefinition as PiToolDefinition,
  ResourceLoader
} from '@mariozechner/pi-coding-agent';
import {
  AuthStorage,
  createAgentSession,
  createExtensionRuntime,
  createSyntheticSourceInfo,
  ModelRegistry,
  SessionManager,
  SettingsManager
} from '@mariozechner/pi-coding-agent';
import { AbstractAgentRuntime, createRuntimeLogger } from '../AbstractAgentRuntime';
import type { AgentRuntimeOptions, AgentExecutionResult, AgentStreamChunk } from '../types';
import { ChunkQueue } from './ChunkQueue';
import { migrateLegacyPiMonoSessionFiles, resolvePiMonoSessionRoot } from './PiMonoSessionPaths';
import { setupEventSubscription } from './PiMonoStreamAdapter';
import { convertTools } from './PiMonoToolConverter';

const log = createRuntimeLogger('pimono-runtime');
const DEFAULT_CONTEXT_WINDOW = 204800;

export function applyPiMonoCustomTools(
  sessionConfig: CreateAgentSessionOptions,
  allSdkTools: PiToolDefinition[]
): void {
  if (allSdkTools.length === 0) return;

  sessionConfig.customTools = allSdkTools;
  sessionConfig.tools = Array.from(new Set(allSdkTools.map((tool) => tool.name)));
}

function resolveContextWindow(modelMeta?: AgentRuntimeOptions['modelMeta']): number {
  return modelMeta?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
}

/**
 * 构造 Anthropic 模型对象
 */
function createAnthropicModel(
  providerName: string,
  modelName: string,
  baseURL: string,
  modelMeta?: AgentRuntimeOptions['modelMeta']
): Model<'anthropic-messages'> {
  const reasoning = modelMeta?.reasoning ?? true;
  const contextWindow = resolveContextWindow(modelMeta);
  const maxTokens = modelMeta?.maxOutputTokens ?? 131072;
  return {
    id: modelName,
    name: modelName,
    api: 'anthropic-messages',
    provider: providerName,
    baseUrl: baseURL,
    reasoning,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'X-Custom-Auth': 'bearer-token-here'
    }
  };
}

/**
 * 构造 OpenAI Chat Completions 兼容的 Model 对象
 *
 * 不使用 SDK 内置的 getModel() 来获取 anthropic-messages 类型的模型，
 * 而是手动构造一个 openai-completions 类型的 Model 对象，
 * 指向 OpenAI 兼容的后端 API（MiniMax、DeepSeek、DashScope 等）。
 *
 * modelMeta 由 coobee.json5 中的模型配置透传，包含 reasoning、contextWindow 等。
 * 当 reasoning=true 时启用 supportsReasoningEffort，使 SDK 正确解析 reasoning_content。
 */
function createOpenAICompatModel(
  providerName: string,
  modelName: string,
  baseURL: string,
  modelMeta?: AgentRuntimeOptions['modelMeta']
): Model<'openai-completions'> {
  const reasoning = modelMeta?.reasoning ?? true;
  const contextWindow = resolveContextWindow(modelMeta);
  const maxTokens = modelMeta?.maxOutputTokens ?? 131072;

  return {
    id: modelName,
    name: modelName,
    api: 'openai-completions',
    provider: providerName,
    baseUrl: baseURL,
    reasoning,
    input: ['text', 'image'],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0
    },
    contextWindow,
    maxTokens,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: reasoning,
      supportsUsageInStreaming: true,
      maxTokensField: 'max_tokens'
    }
  };
}

/**
 * Pi-Mono Agent 运行时
 *
 * 基于 pi-coding-agent SDK 实现 AgentRuntime 接口。
 *
 * 职责：
 * 1. 构造 OpenAI 兼容的 Model 对象（openai-completions API）
 * 2. 通过 createAgentSession() 创建 SDK AgentSession
 * 3. 通过 session.subscribe() 订阅事件，映射为 AgentStreamChunk
 * 4. 通过 StreamEmitter 广播事件到 EventBus
 * 5. 管理会话生命周期
 */
export class PiMonoAgentRuntime extends AbstractAgentRuntime {
  constructor(options: AgentRuntimeOptions) {
    super(options);
  }

  /**
   * 创建 AgentSession
   * @param options 运行时选项
   * @returns AgentSession
   */
  async createSession(options: AgentRuntimeOptions): Promise<AgentSession> {
    const modelName = options.model;
    const baseURL = options.baseURL;
    const thinkingLevel = options.thinkingLevel || 'medium';
    const cwd = this.requireWorkspaceRoot(options);

    // 1. 构造 OpenAI 兼容的 Model 对象（从 coobee.json5 模型配置透传元数据）
    const model =
      options.apiKey == 'anthropic'
        ? createAnthropicModel(options.provider, modelName, baseURL, options.modelMeta)
        : createOpenAICompatModel(options.provider, modelName, baseURL, options.modelMeta);

    // 2. 认证配置
    //    通过 AuthStorage 注入 API key，使用自定义 provider 名称
    //    新版本使用静态工厂方法 AuthStorage.inMemory() 创建实例
    const authStorage = this.createAuthStorage(options);
    const modelRegistry = this.createModelRegistry(authStorage, options);
    const sessionManager = await this.createSessionManager(cwd, options);
    const settingsManager = this.createSettingsManager(options);
    const { resourceLoader, piSkills } = this.createResourceLoader(options);
    const allSdkTools = await this.createSdkTools(options);
    const sessionConfig = this.createSessionConfig({
      cwd,
      model,
      thinkingLevel,
      authStorage,
      modelRegistry,
      sessionManager,
      settingsManager,
      resourceLoader,
      allSdkTools
    });

    const { session } = await createAgentSession(sessionConfig);

    log.info(
      `Initialized: ${options.name} ` +
        `(api: openai-completions, model: ${modelName}, ` +
        `baseURL: ${baseURL}, ` +
        `thinking: ${thinkingLevel}, ` +
        `reasoning: ${model.reasoning}, ` +
        `tools: ${allSdkTools.length}, ` +
        `skills: ${piSkills.length}, ` +
        `session: ${options.sessionId})`
    );
    return session;
  }

  /**
   * 流式执行 Agent（核心实现 — 由基类 stream() 模板方法包装）
   *
   * 通过 session.subscribe() 订阅 pi-SDK 事件，
   * 使用 ChunkQueue 桥接回调式推送到 AsyncGenerator 拉取。
   *
   * 双通道分发：
   *   1. yield chunk — 拉取模式（供 SSE / 直接迭代）
   *   2. StreamEmitter EventBus — 推送模式（广播到 WebSocket）
   *
   * 事件时序：
   *   run:start → turn:start → llm:start → { reasoning:*, text:*, tool:* } → llm:done → turn:done → run:done
   */
  protected async *doStream(input: string): AsyncGenerator<AgentStreamChunk, AgentExecutionResult, unknown> {
    const options = this.options;
    const startTime = Date.now();
    const queue = new ChunkQueue<AgentStreamChunk>();
    const executionSignal = options.signal;
    log.info(`[PiMonoRuntime] Running stream: ${options.name}`);

    const piSession = await this.createSession(options);

    // 构造请求预览（用于调试；并非 SDK 最终发出的逐字原始请求）
    const rawApiRequest = this.buildRequestPreview(input, options, piSession);

    try {
      // 1. run:start
      queue.push({ type: 'run:start', content: '' });

      // 2. 设置事件订阅 → push 到 queue
      let fullOutput = '';
      let apiError: string | null = null;
      const toolCalls: AgentExecutionResult['toolCalls'] = [];

      const unsubscribe = setupEventSubscription(
        piSession,
        {
          onChunk: (chunk) => queue.push(chunk),
          onTextDelta: (text) => {
            fullOutput += text;
          },
          toolCalls,
          onApiError: (errorMessage) => {
            apiError = errorMessage;
          },
          contextWindow: resolveContextWindow(options.modelMeta)
        },
        log
      );

      // 2.5. 监听 AbortSignal，调用 Agent 的 abort() 方法
      const abortListener = (): void => {
        log.info(`[PiMonoRuntime] Aborting session via Agent.abort()`);
        piSession.agent.abort();
      };
      if (executionSignal) {
        executionSignal.addEventListener('abort', abortListener, { once: true });
      }

      /** 延迟抛出：供 AbstractAgentRuntime.stream() 捕获并重试（勿在队列内吞掉异常） */
      let capturedError: unknown = null;

      // 3. SDK 执行，完成后结束 queue
      piSession
        .prompt(input)
        .then(async () => {
          // 清理 abort 监听器
          if (executionSignal) {
            executionSignal.removeEventListener('abort', abortListener);
          }
          unsubscribe();
          // 等待一个微任务周期，确保 SDK 已排队的事件回调有机会执行完毕
          // （pi-SDK 内部可能通过 Promise/microtask 分发最后的 delta 事件）
          await Promise.resolve();

          if (apiError) {
            // API 返回了错误（如 usage limit exceeded）但 SDK 没有 throw — 转为异常交给基类重试策略
            capturedError = new Error(apiError);
          } else {
            queue.push({ type: 'run:done', content: '' });
          }
          queue.end();
        })
        .catch(async (err: unknown) => {
          // 清理 abort 监听器
          if (executionSignal) {
            executionSignal.removeEventListener('abort', abortListener);
          }

          unsubscribe();
          await Promise.resolve();
          capturedError = err;
          queue.end();
        });

      // 4. 逐个 yield 队列中的 chunk
      for await (const chunk of queue) {
        yield chunk;
      }

      if (capturedError) {
        throw capturedError instanceof Error ? capturedError : new Error(String(capturedError));
      }

      return {
        output: fullOutput,
        ...(apiError ? { error: apiError } : {}),
        toolCalls,
        duration: Date.now() - startTime,
        metadata: {
          sessionId: options.sessionId
        },
        rawApiRequest
      };
    } catch (error: unknown) {
      log.error(`Stream execution failed:`, error);
      throw error;
    } finally {
      piSession.dispose();
    }
  }

  /**
   * 解析当前运行使用的 session 根目录
   *
   * AgentExecutor 传入的 `sessionDir` 是当前 Thread 的会话产物目录；
   * PiMono SDK 的会话文件统一放到 sessionDir/sessions/。
   */
  private getSessionRoot(cwd: string, options: AgentRuntimeOptions): string {
    return resolvePiMonoSessionRoot(cwd, options);
  }

  private requireWorkspaceRoot(options: AgentRuntimeOptions): string {
    if (!options.workspaceRoot) {
      throw new Error(`[PiMonoAgentRuntime] workspaceRoot is required: sessionId=${options.sessionId || '(unknown)'}`);
    }
    return options.workspaceRoot;
  }

  private createAuthStorage(options: AgentRuntimeOptions): AuthStorage {
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(options.provider, options.apiKey);
    return authStorage;
  }

  private createModelRegistry(authStorage: AuthStorage, _options: AgentRuntimeOptions): ModelRegistry {
    return ModelRegistry.inMemory(authStorage);
  }

  private async createSessionManager(cwd: string, options: AgentRuntimeOptions): Promise<SessionManager> {
    if (options.sessionMode !== 'file') {
      return SessionManager.inMemory(cwd);
    }

    const sessionDir = this.getSessionRoot(cwd, options);
    await migrateLegacyPiMonoSessionFiles(options.workspaceRoot, sessionDir, options.sessionId, log);
    const existingSessions = await SessionManager.list(cwd, sessionDir);
    const existing = existingSessions.find((session) => session.id === options.sessionId);
    if (existing) {
      return SessionManager.open(existing.path, sessionDir);
    }

    const sessionManager = SessionManager.create(cwd, sessionDir);
    sessionManager.newSession({ id: options.sessionId });
    return sessionManager;
  }

  private createSettingsManager(options: AgentRuntimeOptions): SettingsManager {
    return SettingsManager.inMemory({
      compaction: {
        enabled: options.compaction?.enabled ?? false,
        reserveTokens: options.compaction?.reserveTokens,
        keepRecentTokens: options.compaction?.keepRecentTokens
      },
      retry: {
        enabled: options.retry?.enabled ?? true,
        maxRetries: options.retry?.maxRetries ?? 3,
        baseDelayMs: options.retry?.baseDelayMs ?? 1000
      }
    });
  }

  private createResourceLoader(options: AgentRuntimeOptions): {
    resourceLoader: ResourceLoader;
    piSkills: Array<{
      name: string;
      description: string;
      filePath: string;
      baseDir: string;
      sourceInfo: ReturnType<typeof createSyntheticSourceInfo>;
      disableModelInvocation: boolean;
    }>;
  } {
    const stubRuntime = createExtensionRuntime();
    const piSkills = (options.skills || []).map((s) => ({
      name: s.name,
      description: s.description,
      filePath: s.filePath || '',
      baseDir: '',
      sourceInfo: createSyntheticSourceInfo(s.filePath || `/virtual/skills/${s.name}/SKILL.md`, {
        source: 'runtime-options',
        scope: 'temporary',
        origin: 'top-level'
      }),
      disableModelInvocation: false
    }));
    const allAppendParts = options.appendInstructions || [];

    const resourceLoader: ResourceLoader = {
      getExtensions: () => ({ extensions: [], errors: [], runtime: stubRuntime }),
      getSkills: () => ({ skills: piSkills, diagnostics: [] }),
      getPrompts: () => ({ prompts: [], diagnostics: [] }),
      getThemes: () => ({ themes: [], diagnostics: [] }),
      getAgentsFiles: () => ({ agentsFiles: [] as Array<{ path: string; content: string }> }),
      getSystemPrompt: () => options.instructions,
      getAppendSystemPrompt: () => allAppendParts,
      extendResources: () => {},
      reload: async () => {}
    };

    return { resourceLoader, piSkills };
  }

  private async createSdkTools(options: AgentRuntimeOptions): Promise<PiToolDefinition[]> {
    const tools = options.tools || [];
    if (tools.length === 0) return [];

    if (!options.sandboxContext) {
      throw new Error(
        `[PiMonoAgentRuntime] sandboxContext is required when tools are configured: ` +
          `sessionId=${options.sessionId || '(unknown)'}`
      );
    }

    return convertTools(tools, {
      sandboxContext: options.sandboxContext,
      log,
      getSignal: () => options.signal
    });
  }

  private createSessionConfig(args: {
    cwd: string;
    model: Model<'openai-completions' | 'anthropic-messages'>;
    thinkingLevel: string;
    authStorage: AuthStorage;
    modelRegistry: ModelRegistry;
    sessionManager: SessionManager;
    settingsManager: SettingsManager;
    resourceLoader: ResourceLoader;
    allSdkTools: PiToolDefinition[];
  }): CreateAgentSessionOptions {
    const sessionConfig: CreateAgentSessionOptions = {
      cwd: args.cwd,
      model: args.model,
      thinkingLevel: args.thinkingLevel as CreateAgentSessionOptions['thinkingLevel'],
      authStorage: args.authStorage,
      modelRegistry: args.modelRegistry,
      sessionManager: args.sessionManager,
      settingsManager: args.settingsManager,
      resourceLoader: args.resourceLoader
    };

    applyPiMonoCustomTools(sessionConfig, args.allSdkTools);

    return sessionConfig;
  }

  /**
   * 构造请求预览（OpenAI Chat Completions 风格）
   *
   * 这不是 SDK 真正发出的逐字请求体，而是基于 runtime 已知信息推导出的调试预览。
   * 用于排障时快速理解本次运行的大致上下文构成。
   */
  private buildRequestPreview(
    userInput: string,
    options: AgentRuntimeOptions,
    piSession: AgentSession
  ): AgentExecutionResult['rawApiRequest'] {
    const messages: Array<{ role: string; content: string }> = [];

    // 1. System Message（instructions + appendInstructions）
    let systemContent = options.instructions || '';
    if (options.appendInstructions && options.appendInstructions.length > 0) {
      systemContent += '\n\n' + options.appendInstructions.join('\n\n');
    }
    if (systemContent) {
      messages.push({ role: 'system', content: systemContent });
    }

    // 2. 历史消息（从 pi-session 获取）
    const sessionMessages = piSession.messages || [];
    for (const msg of sessionMessages) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msgAny = msg as any;
      if (msgAny.role && msgAny.content) {
        messages.push({
          role: msgAny.role === 'model' ? 'assistant' : msgAny.role,
          content: typeof msgAny.content === 'string' ? msgAny.content : JSON.stringify(msgAny.content)
        });
      }
    }

    // 3. 当前用户消息
    messages.push({ role: 'user', content: userInput });

    // 4. Tools（如果有）
    // 注：parameters 是 Zod Schema，这里简化存储为工具名称列表
    const tools = options.tools?.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description
      }
    }));

    return {
      source: 'runtime-synthesized-preview',
      sdk: 'pi-coding-agent',
      model: options.model,
      messages,
      ...(tools && tools.length > 0 ? { tools } : {}),
      stream: true,
      ...(options.thinkingLevel ? { thinking_level: options.thinkingLevel } : {})
    };
  }

  // runStream() 由基类 AbstractAgentRuntime 提供
}
