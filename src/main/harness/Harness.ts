import type { Logger } from './logger/Logger';
import { orNop } from './logger/Logger';
import type { SessionStore } from './session/SessionStore';
import { RuntimeEventBus } from './event/RuntimeEventBus';
import type { EventBus } from './event/EventBus';
import { StandardEmitter } from './event/Emitter';
import { ExtensionSubsystem } from './extension/ExtensionSubsystem';
import type { HookRunner } from './extension/hook/HookRunner';
import { ToolRegistry } from './tools/ToolRegistry';
import { registerBuiltins } from './tools/builtin/registerBuiltins';
import { registerSpawn } from './spawn/SpawnSubagentTool';
import type { Tool } from './tools/definition/Tool';
import { AgentFactory, type AgentBackend } from './agent/AgentFactory';
import type { AgentOptions } from './agent/AgentOptions';
import { defaultOrchestrator } from './orchestrate/DefaultOrchestrator';
import { RunDeps } from './orchestrate/RunDeps';
import { Runner, type RunnerCreator } from './runner/Runner';
import { RunnerConfig } from './runner/RunnerConfig';
import type { ModelProvider } from './model/ModelProvider';
import { newDefaultProvider } from './model/ModelProvider';
import { loadSubagentModelPolicy, resolveSharedSkillsRoot } from './config/ConfigLoader';
import { getBackgroundStore } from './tools/builtin/BackgroundStore';

export interface HarnessOptions {
  agentRoot: string;
  workspaceRoot: string;
  sessionRoot: string;
  sharedSkillsRoot?: string;
  runtimeId?: string;
  agentId?: string;
  sessionId?: string;
  userId?: string;
  backend?: AgentBackend;
  defaultModel?: string;
  defaultProvider?: string;
  defaultBaseUrl?: string;
  defaultApiKey?: string;
  defaultTemperature?: number;
  defaultThinkingLevel?: string;
  subagentModel?: string;
  subagentFlashOptimization?: boolean;
  compactionContextWindow?: number;
  compactionThresholdRatio?: number;
  compactionKeepRatio?: number;
  compactionMinMessageCount?: number;
  compactionDebug?: boolean;
  logger?: Logger;
  session: SessionStore;
  factory?: AgentFactory;
  llm?: ModelProvider;
}

/**
 * 进程长驻装配根：New → NewRunner → Runner.Run(signal)。
 */
export class Harness {
  private readonly store: SessionStore;
  private readonly eventBus: RuntimeEventBus;
  private readonly ext: ExtensionSubsystem;
  private readonly factory: AgentFactory;
  private readonly toolReg: ToolRegistry;
  private readonly logger: Logger;
  private readonly options: HarnessOptions;
  private readonly llm: ModelProvider;

  private constructor(
    options: HarnessOptions,
    store: SessionStore,
    eventBus: RuntimeEventBus,
    ext: ExtensionSubsystem,
    factory: AgentFactory,
    toolReg: ToolRegistry,
    logger: Logger,
    llm: ModelProvider
  ) {
    this.options = options;
    this.store = store;
    this.eventBus = eventBus;
    this.ext = ext;
    this.factory = factory;
    this.toolReg = toolReg;
    this.logger = logger;
    this.llm = llm;
  }

  static async create(opts: HarnessOptions): Promise<Harness> {
    validateOptions(opts);
    const logger = orNop(opts.logger);
    const toolReg = new ToolRegistry();
    toolReg.setLogger(logger);

    const bus = new RuntimeEventBus();
    const ext = ExtensionSubsystem.create();
    toolReg.setHooks(ext.hookRunner);

    const sharedSkillsRoot = resolveSharedSkillsRoot(opts.sharedSkillsRoot);
    const policy = await loadSubagentModelPolicy(opts.agentRoot);

    const baseOptions: AgentOptions = {
      agentRoot: opts.agentRoot,
      workspaceRoot: opts.workspaceRoot,
      sessionRoot: opts.sessionRoot,
      sharedSkillsRoot,
      runtimeId: opts.runtimeId,
      agentId: opts.agentId,
      sessionId: opts.sessionId,
      userId: opts.userId,
      defaultModel: opts.defaultModel,
      defaultProvider: opts.defaultProvider,
      defaultBaseUrl: opts.defaultBaseUrl,
      defaultApiKey: opts.defaultApiKey,
      defaultTemperature: opts.defaultTemperature,
      defaultThinkingLevel: opts.defaultThinkingLevel,
      subagentModel: opts.subagentModel ?? policy.subagentModel,
      subagentFlashOptimization: opts.subagentFlashOptimization ?? policy.subagentFlashOptimization,
      compactionContextWindow: opts.compactionContextWindow,
      compactionThresholdRatio: opts.compactionThresholdRatio,
      compactionKeepRatio: opts.compactionKeepRatio,
      compactionMinMessageCount: opts.compactionMinMessageCount,
      compactionDebug: opts.compactionDebug
    };

    const llm =
      opts.llm ??
      newDefaultProvider(
        opts.defaultBaseUrl || process.env.OPENAI_BASE_URL || '',
        opts.defaultApiKey || process.env.OPENAI_API_KEY || ''
      );

    const factory =
      opts.factory ??
      new AgentFactory({
        backend: opts.backend ?? 'stub',
        baseOptions,
        logger,
        toolRegistry: toolReg,
        sessionStore: opts.session,
        modelProvider: llm
      });

    logger.info(`[harness] initialized backend=${opts.backend ?? 'stub'} session_root=${opts.sessionRoot}`);

    return new Harness(opts, opts.session, bus, ext, factory, toolReg, logger, llm);
  }

  async newRunner(cfg: RunnerConfig): Promise<Runner> {
    cfg.ensureRunId();
    if (!cfg.agentRoot) cfg.agentRoot = this.options.agentRoot;
    if (!cfg.workspaceRoot) cfg.workspaceRoot = this.options.workspaceRoot;
    if (!cfg.sessionRoot) cfg.sessionRoot = this.options.sessionRoot;
    if (!cfg.runtimeId) cfg.runtimeId = this.options.runtimeId ?? '';
    if (!cfg.agentId) cfg.agentId = this.options.agentId ?? '';
    if (!cfg.userId) cfg.userId = this.options.userId ?? '';
    if (!cfg.sessionId) cfg.sessionId = this.options.sessionId ?? '';

    const meta = cfg.emitterFullMeta();
    const emitter = new StandardEmitter(this.eventBus, meta);
    const agent = await this.factory.newAgent(cfg.agentOverride());
    const deps = new RunDeps(this.store, emitter, this.ext.hookRunner, this.logger);

    return new Runner({
      orchestrator: defaultOrchestrator,
      agent,
      deps,
      config: cfg
    });
  }

  runnerCreator(): RunnerCreator {
    return (cfg) => this.newRunner(cfg);
  }

  toolRegistry(): ToolRegistry {
    return this.toolReg;
  }

  hookRunner(): HookRunner {
    return this.ext.hookRunner;
  }

  sessionStore(): SessionStore {
    return this.store;
  }

  getEventBus(): EventBus {
    return this.eventBus;
  }

  getLogger(): Logger {
    return this.logger;
  }

  modelProvider(): ModelProvider {
    return this.llm;
  }

  async registerTool(tool: Tool, extensionId = ''): Promise<void> {
    await this.toolReg.register({ tool, extensionId });
  }

  async registerAllTools(): Promise<void> {
    await registerBuiltins(this.toolReg, this.store);
    await registerSpawn(
      this.toolReg,
      this.runnerCreator(),
      {
        subagentModel: this.options.subagentModel ?? this.factory.baseOpts().subagentModel ?? '',
        subagentFlashOptimization:
          this.options.subagentFlashOptimization ?? this.factory.baseOpts().subagentFlashOptimization ?? true
      },
      this.store,
      this.logger
    );
    this.logger.info(`[harness] registerAllTools: ${this.toolReg.names().length} tools registered`);
  }

  /** 回合结束后清理后台进程。 */
  purgeBackgroundProcesses(sessionId: string): void {
    getBackgroundStore().purgeSession(sessionId);
  }
}

function validateOptions(opts: HarnessOptions): void {
  if (!opts.agentRoot || !opts.workspaceRoot || !opts.sessionRoot) {
    throw new Error('kernel: AgentRoot, WorkspaceRoot, and SessionRoot are required');
  }
  if (!opts.session) {
    throw new Error('kernel: Session is required (construct FileSessionStore or InMemorySessionStore)');
  }
}
