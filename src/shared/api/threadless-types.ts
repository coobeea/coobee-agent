/**
 * Threadless API 类型定义
 *
 * 前后端共享的请求/响应类型（VO - View Object）。
 *
 * Threadless 场景：不依赖持久化 Chat Thread 的一次性 Agent 调用，
 * 适用于输入框润色、摘要、翻译、字段生成等轻量 AI 能力。
 *
 * 通信协议：HTTP（非 WebSocket RPC），走 `POST /gateway/threadless/run`。
 */

import type { ApiResponse } from '@shared/api';

// 重新导出供外部使用
export type { ApiResponse };

/**
 * 支持的 Agent 运行时种类。
 */
export type ThreadlessRuntimeType = 'pi-mono' | 'openai' | 'claude';

/**
 * 支持的执行模式。
 */
export type ThreadlessMode = 'chat' | 'agent';

/**
 * POST /gateway/threadless/run
 * 一次性 Agent 调用请求
 */
export interface ThreadlessRunReqVO {
  /** Agent ID，默认 'app-copilot' */
  agentId?: string;
  /** 用户消息（必填，非空字符串） */
  message: string;
  /** 本次请求的附加系统约束，追加到 Agent 默认 instructions 之后 */
  instructions?: string;
  /** 运行时类型，默认 'pi-mono' */
  runtimeType?: ThreadlessRuntimeType;
  /** 执行模式，默认 'chat' */
  mode?: ThreadlessMode;
  /** 是否轻量执行，默认 true */
  lightweight?: boolean;
  /** 最大轮数，默认 1 */
  maxTurns?: number;
  /** 自定义 sessionId（不提供时自动生成） */
  sessionId?: string;
  /** 覆盖 Agent 默认模型（provider/model） */
  modelOverride?: string;
  /** 提示词变量（预留，未来用于模板渲染） */
  promptVars?: Record<string, unknown>;
  /** 业务附加元数据（预留，不影响执行） */
  metadata?: Record<string, unknown>;
}

/**
 * POST /gateway/threadless/run
 * 一次性 Agent 调用响应
 */
export interface ThreadlessRunRespVO {
  /** 模型输出的最终文本（已聚合流式 chunk） */
  text: string;
  /** 本次执行使用的 sessionId */
  sessionId?: string;
  /** 预留 usage 字段（初版后端可不返回） */
  usage?: unknown;
}
