/**
 * Gateway 类型定义
 */

import type { WebSocket } from 'ws';
import type Router from '@koa/router';
import type { GatewayRequest, GatewayResponse, GatewayEvent } from '@shared/gateway-protocol';

// 重新导出共享类型
export type { GatewayRequest, GatewayResponse, GatewayEvent };

/** Gateway 出站消息联合类型 */
export type GatewayOutMessage = GatewayResponse | GatewayEvent;

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
 * 客户端过滤谓词
 */
export type ClientPredicate = (meta: ClientMeta) => boolean;

/**
 * 方法执行上下文（Gateway 注入给 handler）
 */
export interface MethodContext {
  /** 客户端连接 ID */
  clientId: string;
  /** WebSocket 连接 */
  ws: WebSocket;
  /** 客户端元数据 */
  meta: ClientMeta;
  /** Gateway 引用（供 handler 调用广播等功能） */
  gateway: GatewayApi;
}

/**
 * 单个方法处理函数
 */
export type MethodHandler = (params: Record<string, unknown>, ctx: MethodContext) => Promise<unknown>;

/**
 * 方法组：一个文件导出一组相关方法
 *
 * 文件放在 src/main/rpc/ 目录，Gateway 自动发现。
 */
export interface MethodGroup {
  /** 命名空间（如 'chat', 'system'） */
  namespace: string;
  /** 方法映射，key 为 action 名（不含 namespace 前缀） */
  methods: Record<string, MethodHandler>;
  /** 初始化回调（Gateway 注入自身引用时调用，可选） */
  onInit?: (gateway: GatewayApi) => void;
}

/**
 * Gateway API（供方法组和 EventBridge 调用）
 */
export interface GatewayApi {
  /** 向单个客户端发送消息 */
  send(ws: WebSocket, payload: GatewayOutMessage): void;

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
