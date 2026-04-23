/**
 * Gateway 统一初始化 Hook
 *
 * 统一初始化整个网络层：
 *   1. HttpServer（Koa + http.Server 基础设施）
 *   2. Gateway（WebSocket + HTTP 业务层）
 *      - 自动扫描 bridges/ → WebSocket 事件桥接
 *      - 自动扫描 routes/ → HTTP REST 路由
 *
 * 执行顺序：
 *   ReadyGatewayHook (45) → ReadyAgentSystemHook (50) → ReadyConfigHook (55)
 */

import { LifecyclePhase, LifecycleContext, LifecycleHook } from '@main/common/types';
import { log } from '@main/common/logger';

export const ReadyGatewayHook: LifecycleHook = {
  name: 'ready-gateway',
  phase: LifecyclePhase.READY,
  priority: 45, // 必须在 Agent System (50) 之前初始化
  critical: false, // 非关键 Hook，失败不阻断应用启动

  async execute(_context: LifecycleContext): Promise<void> {
    log.info('[ReadyGatewayHook] 初始化 Gateway 统一网络层...');

    try {
      const { gateway } = await import('@main/common/gateway');

      // 启动 Gateway（一次性完成 HTTP + WebSocket + 业务层初始化）
      gateway.start();

      log.info('[ReadyGatewayHook] Gateway 统一网络层初始化完成');
    } catch (error) {
      log.error('[ReadyGatewayHook] Gateway 初始化失败:', error);
      // 不抛出错误，允许应用继续运行（Gateway 不是关键功能）
    }
  }
};
