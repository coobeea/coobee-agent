/**
 * Gateway 类型定义
 */

import type { WebSocket } from 'ws';
import type Router from '@koa/router';

/**
 * 客户端元数据
 */
export interface ClientMeta {
  connectionId: string;
  connectedAt: number;
  isAlive: boolean;
  heartbeatTimer: NodeJS.Timeout | null;
}

/**
 * WebSocket 事件消息（Gateway → 客户端）
 */
export interface GatewayEvent {
  type: 'event';
  event: string;
  payload: unknown;
  timestamp: number;
}

/**
 * 客户端过滤谓词
 */
export type ClientPredicate = (meta: ClientMeta) => boolean;

/**
 * Gateway API（供 EventBridge 调用）
 */
export interface GatewayApi {
  /** 向所有客户端广播事件 */
  broadcastEvent(event: string, payload: unknown): void;

  /** 按条件广播事件 */
  broadcastEventIf(event: string, payload: unknown, predicate: ClientPredicate): number;

  /** 遍历所有客户端 */
  forEachClient(callback: (ws: WebSocket, meta: ClientMeta) => void): void;

  /** 客户端数量 */
  readonly clientCount: number;
}

/**
 * EventBridge 初始化函数签名
 *
 * @param gateway Gateway 实例
 * @returns 清理函数（用于移除 EventBus 监听器）
 */
export type EventBridgeInit = (gateway: GatewayApi) => (() => void) | void;

/**
 * HTTP 路由注册函数签名
 *
 * @param router Koa Router 实例
 */
export type RouteRegistrar = (router: Router) => void;
