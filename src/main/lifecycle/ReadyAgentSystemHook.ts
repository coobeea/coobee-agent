/**
 * Agent System Hook — Agent 系统初始化
 *
 * 在 READY 阶段初始化完整的 Agent 工具体系：
 *   1. 注册内置工具到 ToolRegistry（read、write、exec、skill_list 等）
 *   2. 加载所有 Extension（builtin + user）
 *   3. 注册 Extension 工具到 ToolRegistry
 *   4. 初始化 ExtensionManager
 *   5. 启动热插拔监听
 *
 * 执行顺序：
 *   ReadyGatewayHook (45) → ReadyAgentSystemHook (50) → ReadyConfigHook (55)
 *
 * 前置条件：Gateway 已初始化（由 ReadyGatewayHook 完成）
 */

import { LifecyclePhase, type LifecycleContext, type LifecycleHook } from '@main/common/types';
import { log } from '@main/common/logger';

/** 模块级引用，供退出时清理 */
let activeLoader: { stopWatch(): void } | null = null;

export const ReadyAgentSystemHook: LifecycleHook = {
  name: 'ready-agent-system',
  phase: LifecyclePhase.READY,
  priority: 50, // 在 Gateway(45) 之后
  critical: false, // Agent 系统加载失败不阻止应用启动

  async execute(_context: LifecycleContext): Promise<void> {
    log.info('[ReadyAgentSystemHook] Initializing Agent system...');

    try {
      const { Env } = await import('@main/common/env');
      const { ExtensionRegistry, ExtensionLoader, ExtensionManager } = await import('@main/agent/extension');
      const { ToolRegistry } = await import('@main/agent/tools/registry');
      const { builtinTools } = await import('@main/agent/tools/builtin');
      const { eventBus } = await import('@main/common/eventbus');
      const { streamConsumersManager } = await import('@main/agent/streaming/StreamConsumersManager');

      // 0. 初始化流式消费者管理器（必须在最开始，因为后续执行需要监听器）
      streamConsumersManager.init(Env.paths.workspacesDir);
      log.info('[ReadyAgentSystemHook] Stream consumers initialized');

      // 1. 注册内置工具到 ToolRegistry
      const toolRegistry = ToolRegistry.getInstance();
      for (const tool of builtinTools) {
        try {
          toolRegistry.register(tool);
        } catch (err) {
          log.warn(`[ReadyAgentSystemHook] Failed to register builtin tool "${tool.name}":`, err);
        }
      }
      log.info(`[ReadyAgentSystemHook] Registered ${builtinTools.length} builtin tools`);

      // 2. 获取全局搜索路径（只加载 builtin 和 user Extension）
      const globalSearchPaths = [Env.paths.builtinExtensionsDir, Env.paths.userExtensionsDir];

      // 3. 创建注册中心和加载器（传递 eventBus 引用）
      const registry = new ExtensionRegistry();
      const loader = new ExtensionLoader(registry, eventBus);

      // 4. 加载全局 Extension（任务级 Extension 由 AgentExecutor 动态加载）
      await loader.loadAll(globalSearchPaths);

      // 5. 将 Extension 工具注入 ToolRegistry
      const extToolCount = registry.getTools().length;
      for (const { tool } of registry.getTools()) {
        try {
          toolRegistry.register(tool);
        } catch (err) {
          log.warn(`[ReadyAgentSystemHook] Failed to register extension tool "${tool.name}":`, err);
        }
      }
      if (extToolCount > 0) {
        log.info(`[ReadyAgentSystemHook] Registered ${extToolCount} extension tools`);
      }

      // 6. 初始化全局管理器（传递 loader 引用，用于动态加载任务级 Extension）
      ExtensionManager.initialize(registry, loader);

      // 7. 启动所有已注册的 Background Service
      for (const { service } of registry.getServices()) {
        try {
          await service.start();
          log.info(`[ReadyAgentSystemHook] Started background service: ${service.id}`);
        } catch (err) {
          log.error(`[ReadyAgentSystemHook] Failed to start background service "${service.id}":`, err);
        }
      }

      // 8. 启动 fs.watch 热插拔（只监听全局目录）
      loader.watch(globalSearchPaths);
      activeLoader = loader;

      const extIds = registry.getExtensionIds();
      const totalTools = builtinTools.length + extToolCount;
      log.info(`[ReadyAgentSystemHook] Agent system initialized — ${totalTools} tools, ${extIds.length} extensions`);
    } catch (error) {
      log.error('[ReadyAgentSystemHook] Failed to initialize Agent system:', error);
    }
  }
};

/**
 * 退出时停止 Agent 系统
 */
export const BeforeQuitAgentSystemHook: LifecycleHook = {
  name: 'before-quit-agent-system',
  phase: LifecyclePhase.BEFORE_QUIT,
  priority: 30, // 比 Infra(40) 和 Process(50) 更早清理
  critical: false,

  async execute(): Promise<void> {
    // 1. 停止流式消费者
    try {
      const { streamConsumersManager } = await import('@main/agent/streaming/StreamConsumersManager');
      await streamConsumersManager.destroy();
      log.info('[BeforeQuitAgentSystemHook] Stream consumers destroyed');
    } catch (err) {
      log.error('[BeforeQuitAgentSystemHook] Failed to destroy stream consumers:', err);
    }

    // 2. 停止 Extension 监听器
    if (activeLoader) {
      activeLoader.stopWatch();
      activeLoader = null;
      log.info('[BeforeQuitAgentSystemHook] Extension watchers stopped');
    }

    // 3. 停止 Background Services
    try {
      const { ExtensionManager } = await import('@main/agent/extension');
      const registry = ExtensionManager.getRegistry();

      // 停止所有 Background Service
      if (registry) {
        for (const { service } of registry.getServices()) {
          try {
            await service.stop();
            log.info(`[BeforeQuitAgentSystemHook] Stopped background service: ${service.id}`);
          } catch (err) {
            log.error(`[BeforeQuitAgentSystemHook] Failed to stop background service "${service.id}":`, err);
          }
        }
      }
    } catch (err) {
      log.error('[BeforeQuitAgentSystemHook] Failed to stop Agent system:', err);
    }
  }
};
