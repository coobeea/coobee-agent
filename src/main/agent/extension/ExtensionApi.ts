/**
 * ExtensionApi 工厂
 *
 * 为每个 Extension 构建独立的 api 对象，供 register() 调用。
 * 包含 services 属性提供解耦的系统服务访问。
 */

import { ExtensionRegistry } from './ExtensionRegistry';
import type {
  ExtensionApi,
  ExtensionOrigin,
  ExtensionLogger,
  ExtensionServices,
  ExtensionEventBus,
  ExtensionHookName,
  ExtensionHookHandler,
  CronJobConfig
} from './types';

/**
 * 创建 Extension 专属日志器
 */
function createExtensionLogger(extensionId: string): ExtensionLogger {
  const prefix = `[Extension:${extensionId}]`;
  return {
    info: (msg, ...args) => console.log(prefix, msg, ...args),
    warn: (msg, ...args) => console.warn(prefix, msg, ...args),
    error: (msg, ...args) => console.error(prefix, msg, ...args),
    debug: (msg, ...args) => console.debug(prefix, msg, ...args)
  };
}

/**
 * 为单个 Extension 构建 ExtensionApi
 */
export function createExtensionApi(
  extensionId: string,
  name: string,
  origin: ExtensionOrigin,
  registry: ExtensionRegistry,
  bus?: ExtensionEventBus
): ExtensionApi {
  return {
    id: extensionId,
    name,
    origin,
    logger: createExtensionLogger(extensionId),
    services: createExtensionServices(),
    eventBus: bus || createEventBusWrapper(null),
    registerTool(tool) {
      registry.registerTool(extensionId, tool);
    },
    on<K extends ExtensionHookName>(hookName: K, handler: ExtensionHookHandler<K>, opts?: { priority?: number }) {
      registry.registerHook<K>({
        extensionId,
        hookName,
        handler,
        priority: opts?.priority ?? 0
      });
    },
    registerGatewayMethod(method, handler) {
      registry.registerGatewayMethod(extensionId, method, handler);
    },
    registerHttpRoute(config) {
      registry.registerHttpRoute(extensionId, config);
    },
    registerService(service) {
      registry.registerService(extensionId, service);
    },
    registerCronJob(config: CronJobConfig) {
      registry.registerCronJob(extensionId, config);
    }
  };
}

/**
 * 创建 Extension EventBus 包装器
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createEventBusWrapper(bus: any): ExtensionEventBus {
  if (!bus) {
    return {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      on() {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      off() {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      emit() {}
    };
  }

  return {
    on(event, handler) {
      bus.on(event, handler);
    },
    off(event, handler) {
      bus.off(event, handler);
    },
    emit(event, data) {
      bus.emit(event, data);
    }
  };
}

/**
 * 创建 Extension 服务集合
 */
function createExtensionServices(): ExtensionServices {
  return {
    hitl: {
      async waitForSingleDecision(_approvalId, _timeoutMs) {
        return null;
      },
      submitSingleDecision(_approvalId, _decision) {
        return false;
      },
      async cleanupSession(_sessionId) {
        // no-op
      }
    },
    events: {
      emit(sessionId, chunk) {
        import('../AgentEventWriter')
          .then(({ AgentEventWriter }) => {
            AgentEventWriter.dispatchForSession(sessionId, chunk as never);
          })
          .catch(() => {
            // 分发失败不阻断
          });
      }
    },
    paths: {
      async getWorkspace(sessionId) {
        const { Env } = await import('../../common/env');
        return Env.getAgentWorkspaceDir(sessionId);
      },
      async getAgentHome(agentId) {
        const { Env } = await import('../../common/env');
        return Env.getAgentHomeDir(agentId);
      },
      async getUserHome() {
        const { Env } = await import('../../common/env');
        return Env.paths.userHome;
      },
      async getDataDir(extensionId) {
        const { Env } = await import('../../common/env');
        const path = await import('node:path');
        const dataDir = path.default.join(Env.paths.userHome, 'extensions', extensionId, 'data');
        const fs = await import('node:fs');
        if (!fs.default.existsSync(dataDir)) {
          fs.default.mkdirSync(dataDir, { recursive: true });
        }
        return dataDir;
      },
      async getConfigDir() {
        const { Env } = await import('../../common/env');
        return Env.paths.configDir;
      },
      async getSecretsDir() {
        const { Env } = await import('../../common/env');
        return Env.paths.secretsDir;
      },
      async getWorkspacesDir() {
        const { Env } = await import('../../common/env');
        return Env.paths.workspacesDir;
      }
    },
    llm: {
      async chat(_messages) {
        throw new Error('Not implemented');
      },
      async runAgent(agentId, message) {
        const { agentExecutor } = await import('../AgentExecutor');
        const { AgentStore } = await import('../agents/AgentStore');
        const { generateSnowflakeId } = await import('../../utils/SnowflakeIdGenerator');

        const store = await AgentStore.getInstance();
        const agentDef = await store.get(agentId);
        if (!agentDef) {
          throw new Error(`Agent "${agentId}" not found`);
        }

        const sessionId = `ext-agent-${agentId}-${generateSnowflakeId()}`;
        const builder = agentExecutor
          .piMono()
          .lightweight(true)
          .mode('chat')
          .name(agentId)
          .sessionMode('memory')
          .maxTurns(1);

        if (agentDef.instructions) {
          builder.instructions(agentDef.instructions);
        }

        if (agentDef.model) {
          agentExecutor.applyProviderConfig(builder, { modelOverride: agentDef.model });
        }

        const builderAny = builder as Parameters<typeof agentExecutor.stream>[0]['builder'] & {
          _modelMeta?: Record<string, unknown>;
        };

        const defAny = agentDef as unknown as Record<string, unknown>;
        if (typeof defAny.temperature === 'number' || typeof defAny.maxTokens === 'number') {
          builderAny._modelMeta = builderAny._modelMeta || {};
          if (typeof defAny.temperature === 'number') {
            builderAny._modelMeta.temperature = defAny.temperature;
          }
          if (typeof defAny.maxTokens === 'number') {
            builderAny._modelMeta.max_tokens = defAny.maxTokens;
          }
        }

        let output = '';
        const gen = agentExecutor.stream({ sessionId, message, builder });
        for await (const chunk of gen) {
          if (chunk.type === 'text:delta' && chunk.content) {
            output += chunk.content;
          }
        }
        return output;
      },
      async embed(_texts, _options) {
        throw new Error('Not implemented');
      }
    },
    agent: {
      async getExecutor() {
        const { agentExecutor } = await import('../AgentExecutor');
        return agentExecutor;
      },
      async getStore() {
        const { AgentStore } = await import('../agents/AgentStore');
        return AgentStore.getInstance();
      },
      async getBuiltinTools() {
        return []; // placeholder
      },
      async getToolRegistry() {
        const { ToolRegistry } = await import('../tools/registry');
        return ToolRegistry.getInstance();
      },
      async getSkillManager() {
        const { SkillManager } = await import('../skills');
        return new SkillManager();
      }
    },
    thread: {
      async getStore() {
        const { ThreadStore } = await import('../threads/ThreadStore');
        return ThreadStore.getInstance();
      }
    },
    types: {
      async getStreamEventType() {
        const { StreamEventType } = await import('../streaming/types');
        return StreamEventType;
      }
    }
  };
}
