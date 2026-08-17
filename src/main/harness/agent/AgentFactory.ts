import type { Logger } from '../logger/Logger';
import { orNop } from '../logger/Logger';
import type { ToolRegistry } from '../tools/ToolRegistry';
import type { SessionStore } from '../session/SessionStore';
import type { ModelProvider } from '../model/ModelProvider';
import { newDefaultProvider } from '../model/ModelProvider';
import type { Agent } from './Agent';
import type { AgentOptions } from './AgentOptions';
import { mergeAgentOptions } from './AgentOptions';
import { StubAgent } from './StubAgent';
import { OpenAIAgent } from './openai/OpenAIAgent';

export type AgentBackend = 'stub' | 'openai';

export interface AgentFactoryConfig {
  backend: AgentBackend;
  baseOptions: AgentOptions;
  logger?: Logger;
  toolRegistry?: ToolRegistry;
  sessionStore?: SessionStore;
  modelProvider?: ModelProvider;
}

/**
 * Agent 工厂：持有进程级 baseOpts，按轮 Merge 后创建实例。
 */
export class AgentFactory {
  private readonly backend: AgentBackend;
  private readonly baseOptions: AgentOptions;
  private readonly logger: Logger;
  private readonly toolRegistry?: ToolRegistry;
  private readonly sessionStore?: SessionStore;
  private readonly modelProvider?: ModelProvider;

  constructor(config: AgentFactoryConfig) {
    this.backend = config.backend;
    this.baseOptions = config.baseOptions;
    this.logger = orNop(config.logger);
    this.toolRegistry = config.toolRegistry;
    this.sessionStore = config.sessionStore;
    this.modelProvider = config.modelProvider;
  }

  baseOpts(): AgentOptions {
    return { ...this.baseOptions };
  }

  async newAgent(override: Partial<AgentOptions> = {}): Promise<Agent> {
    const opts = mergeAgentOptions(this.baseOptions, override);
    this.logger.debug(
      `[agent-factory] newAgent backend=${this.backend} session=${opts.sessionId} scope=${opts.scope || '(main)'}`
    );
    switch (this.backend) {
      case 'stub':
        return new StubAgent(opts);
      case 'openai': {
        if (!this.toolRegistry || !this.sessionStore) {
          throw new Error('agent: openai backend requires toolRegistry and sessionStore');
        }
        const provider = this.modelProvider ?? newDefaultProvider(opts.defaultBaseUrl || '', opts.defaultApiKey || '');
        return new OpenAIAgent(opts, {
          modelProvider: provider,
          toolRegistry: this.toolRegistry,
          sessionStore: this.sessionStore,
          logger: this.logger
        });
      }
      default:
        throw new Error(`agent: unknown backend: ${this.backend}`);
    }
  }
}
