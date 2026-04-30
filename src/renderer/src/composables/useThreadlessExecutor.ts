/**
 * useThreadlessExecutor
 *
 * “无会话轻量 Agent 请求”的通用组合式 API，对应后端
 * `ThreadlessExecutor.runMessage`，用于输入框润色、摘要、翻译、字段生成等
 * 无需持久化 Thread 的场景。
 *
 * 设计约束：
 *   - 通信协议：HTTP（`POST /gateway/threadless/run`），不走 WebSocket RPC，
 *     不依赖 Gateway 连接状态。
 *   - 不创建 Thread、不写 `chatStore`、不监听 `stream:*`。
 *   - 默认参数与后端保持一致：`agentId='app-copilot'`、`mode='chat'`、
 *     `lightweight=true`、`maxTurns=1`。
 *   - 错误统一抛出 `Error`，由调用方决定 UI 展示。
 */

import { runThreadless } from '@/api/threadless';
import type {
  ThreadlessRunReqVO,
  ThreadlessRunRespVO,
  ThreadlessRuntimeType,
  ThreadlessMode
} from '@shared/api/threadless-types';

export type { ThreadlessRuntimeType, ThreadlessMode };

/** `useThreadlessExecutor().run()` 的入参 */
export interface ThreadlessRunOptions {
  /** 必填：用户消息 */
  message: string;
  /** Agent ID，默认 'app-copilot' */
  agentId?: string;
  /** 附加系统约束（本次请求一次性，不持久化到 Agent 配置） */
  instructions?: string;
  /** Runtime 类型，默认 'pi-mono' */
  runtimeType?: ThreadlessRuntimeType;
  /** 执行模式，默认 'chat' */
  mode?: ThreadlessMode;
  /** 是否轻量执行，默认 true */
  lightweight?: boolean;
  /** 最大轮数，默认 1 */
  maxTurns?: number;
  /** 自定义 sessionId（不传则后端自动生成） */
  sessionId?: string;
  /** 覆盖 Agent 默认模型 */
  modelOverride?: string;
  /** 模板变量（预留） */
  promptVars?: Record<string, unknown>;
  /** 业务附加元数据（预留） */
  metadata?: Record<string, unknown>;
  /** AbortSignal，可选；abort 后会关闭 HTTP 连接并触发服务端中断 */
  signal?: AbortSignal;
}

/** 组合式 API 返回值 */
export interface ThreadlessExecutor {
  run: (options: ThreadlessRunOptions) => Promise<ThreadlessRunRespVO>;
}

/** 前端默认参数（与后端保持一致） */
const DEFAULTS = {
  agentId: 'app-copilot',
  mode: 'chat' as ThreadlessMode,
  lightweight: true,
  maxTurns: 1
} as const;

/**
 * 创建一个 Threadless 执行器。
 *
 * @example
 *   const { run } = useThreadlessExecutor();
 *   const { text } = await run({ message: '一句话介绍 coobee' });
 */
export function useThreadlessExecutor(): ThreadlessExecutor {
  async function run(options: ThreadlessRunOptions): Promise<ThreadlessRunRespVO> {
    // 前端保护：空消息不发起 HTTP
    const message = options.message?.trim();
    if (!message) {
      throw new Error('message is required and must be a non-empty string');
    }

    const payload: ThreadlessRunReqVO = {
      message,
      agentId: options.agentId ?? DEFAULTS.agentId,
      instructions: options.instructions,
      runtimeType: options.runtimeType,
      mode: options.mode ?? DEFAULTS.mode,
      lightweight: options.lightweight ?? DEFAULTS.lightweight,
      maxTurns: options.maxTurns ?? DEFAULTS.maxTurns,
      sessionId: options.sessionId,
      modelOverride: options.modelOverride,
      promptVars: options.promptVars,
      metadata: options.metadata
    };

    const resp = await runThreadless(payload, { signal: options.signal });

    if (!resp.success || !resp.data) {
      throw new Error(resp.error || 'Threadless run failed');
    }

    return resp.data;
  }

  return { run };
}
