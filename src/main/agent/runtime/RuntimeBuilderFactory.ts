import { createLogger } from '@main/common/logger';

import { ProviderInjector } from '../provider/ProviderInjector';
import { OpenAIBuilder } from './openai/OpenAIBuilder';
import { PiMonoBuilder } from './pimono/PiMonoBuilder';
import type { RuntimeBuilderRequest, RuntimeKind } from './types';

const log = createLogger('runtime-builder-factory');

export type RuntimeBuilder = PiMonoBuilder | OpenAIBuilder;

type RuntimeProviderInjector = Pick<ProviderInjector, 'applyProviderConfig' | 'applyThinkingLevel'>;

/**
 * Runtime Builder Factory
 *
 * 负责根据抽象运行语义创建具体 Builder，并在 runtime 层内部完成：
 *   - runtime 选择
 *   - thread / memory 持久化语义映射
 *   - provider 配置注入
 *   - 默认 thinkingLevel 注入
 */
export class RuntimeBuilderFactory {
  private static instance: RuntimeBuilderFactory | null = null;

  constructor(private readonly providerInjector: RuntimeProviderInjector) {}

  static getInstance(providerInjector?: RuntimeProviderInjector): RuntimeBuilderFactory {
    if (!RuntimeBuilderFactory.instance) {
      RuntimeBuilderFactory.instance = new RuntimeBuilderFactory(providerInjector || new ProviderInjector());
    }
    return RuntimeBuilderFactory.instance;
  }

  static resetInstance(): void {
    RuntimeBuilderFactory.instance = null;
  }

  create(request: RuntimeBuilderRequest): RuntimeBuilder {
    const runtime = this.resolveRuntimeKind(request);
    const builder = this.createConcreteBuilder(runtime);

    this.applyCommonConfig(builder, request);
    this.applyPersistence(runtime, builder, request);
    this.applyProviderConfig(builder, request);

    log.debug(
      `[RuntimeBuilderFactory] create runtime=${runtime} mode=${request.mode || 'agent'} persistence=${request.persistence || 'memory'}`
    );

    return builder;
  }

  private resolveRuntimeKind(request: RuntimeBuilderRequest): RuntimeKind {
    // 当前默认策略保持与现有 thread 长会话主路径一致，优先走 PiMono。
    // 后续如需按配置或模型路由，可只在这里扩展，不影响入口层。
    return request.runtime || 'pimono';
  }

  private createConcreteBuilder(runtime: RuntimeKind): RuntimeBuilder {
    switch (runtime) {
      case 'openai':
        return new OpenAIBuilder();
      case 'pimono':
      default:
        return new PiMonoBuilder();
    }
  }

  private applyCommonConfig(builder: RuntimeBuilder, request: RuntimeBuilderRequest): void {
    builder.mode(request.mode || 'agent');

    if (request.agentId) builder.agentId(request.agentId);
    if (request.name) builder.name(request.name);
    if (request.instructions !== undefined) builder.instructions(request.instructions);
    if (request.sessionId) builder.sessionId(request.sessionId);
    if (request.sessionDir) builder.sessionDir(request.sessionDir);
    if (request.workspaceRoot) builder.workspaceRoot(request.workspaceRoot);
    if (request.contextDir) builder.contextDir(request.contextDir);
    if (request.maxTurns !== undefined) builder.maxTurns(request.maxTurns);
  }

  private applyPersistence(_runtime: RuntimeKind, builder: RuntimeBuilder, request: RuntimeBuilderRequest): void {
    const persistence = request.persistence || 'memory';

    if (builder instanceof PiMonoBuilder) {
      builder.sessionMode(persistence === 'thread' ? 'file' : 'memory');
    }
  }

  private applyProviderConfig(builder: RuntimeBuilder, request: RuntimeBuilderRequest): void {
    this.providerInjector.applyProviderConfig(builder);
    this.providerInjector.applyThinkingLevel(builder);

    if (request.modelOverride) {
      this.providerInjector.applyProviderConfig(builder, {
        modelOverride: request.modelOverride,
        sessionId: request.sessionId,
        agentId: request.agentId
      });
    }
  }
}
