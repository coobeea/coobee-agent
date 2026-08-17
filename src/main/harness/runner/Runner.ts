import type { Agent } from '../agent/Agent';
import type { Orchestrator } from '../orchestrate/Orchestrator';
import { RunDeps } from '../orchestrate/RunDeps';
import type { Signal } from '../types/Signal';
import type { RunnerConfig } from './RunnerConfig';

export interface RunnerOptions {
  orchestrator: Orchestrator;
  agent: Agent;
  deps: RunDeps;
  config: RunnerConfig;
}

/**
 * 一次完整 Turn 的装配结果：已绑定本轮 RunnerConfig。
 */
export class Runner {
  private readonly orchestrator: Orchestrator;
  private readonly agentInstance: Agent;
  private readonly deps: RunDeps;
  private readonly cfg: RunnerConfig;

  constructor(opts: RunnerOptions) {
    if (!opts.orchestrator || !opts.agent || !opts.deps) {
      throw new Error('runner: orchestrator, agent, and deps required');
    }
    this.orchestrator = opts.orchestrator;
    this.agentInstance = opts.agent;
    this.deps = opts.deps;
    this.cfg = opts.config;
  }

  agent(): Agent {
    return this.agentInstance;
  }

  config(): RunnerConfig {
    return this.cfg;
  }

  /** 执行已绑定的单轮 Turn；只传取消信号。 */
  async run(signal: Signal): Promise<string> {
    if (!signal?.abortSignal) {
      throw new Error('types: signal abortSignal is required');
    }
    return this.orchestrator.run(signal, this.agentInstance, {
      sessionId: this.cfg.sessionId,
      runId: this.cfg.runId,
      runtimeId: this.cfg.runtimeId,
      agentId: this.cfg.agentId,
      userId: this.cfg.userId,
      requestId: this.cfg.requestId,
      parentSessionId: this.cfg.parentSessionId,
      scopedChildDir: this.cfg.scopedChildDir,
      message: this.cfg.message,
      model: this.cfg.model,
      provider: this.cfg.provider,
      instructions: this.cfg.instructions,
      systemAppend: this.cfg.systemAppend,
      skipInputPolicy: this.cfg.skipInputPolicy,
      thinkingLevel: this.cfg.thinkingLevel,
      temperature: this.cfg.temperature,
      attachments: this.cfg.attachments,
      contextWindow: this.cfg.contextWindow,
      queueItemId: this.cfg.queueItemId,
      clientMessageId: this.cfg.clientMessageId,
      agentRoot: this.cfg.agentRoot,
      workspaceRoot: this.cfg.workspaceRoot,
      sessionRoot: this.cfg.sessionRoot,
      policyDefaults: this.cfg.policyDefaults,
      deps: this.deps
    });
  }
}

export type RunnerCreator = (cfg: RunnerConfig) => Promise<Runner>;
