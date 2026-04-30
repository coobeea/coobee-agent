/**
 * Threadless API 客户端
 *
 * 前端对后端 `POST /gateway/threadless/run` 的薄封装，用于一次性（无会话）
 * 轻量 Agent 调用。
 *
 * 通信协议：HTTP（非 WebSocket RPC）。Threadless 场景是一次请求、一次响应，
 * 无需监听 `stream:*` 事件，不依赖 WS 连接状态。
 */

import type { ApiResponse, ThreadlessRunReqVO, ThreadlessRunRespVO } from '@shared/api/threadless-types';
import configManager from '@/config';

// 重新导出类型，便于调用方直接使用
export type { ThreadlessRunReqVO, ThreadlessRunRespVO };

export interface RunThreadlessOptions {
  /** 外部 AbortSignal，用于取消请求 */
  signal?: AbortSignal;
}

/**
 * 调用 Threadless 端点执行一次性 Agent 请求。
 *
 * 直接使用 `fetch`（而非 `apiClient.post`）以便透传 `AbortSignal`，让调用方
 * 能够取消长耗时请求；服务端会通过连接关闭触发底层 `AbortSignal` 中断执行。
 *
 * @param payload 请求体（`ThreadlessRunReqVO`），必须包含非空 `message`
 * @param options 可选控制项（如 `signal`）
 * @returns `ApiResponse<ThreadlessRunRespVO>`
 *
 * @example
 *   const resp = await runThreadless({ message: '你好' });
 *   if (resp.success && resp.data) {
 *     console.log(resp.data.text);
 *   }
 */
export async function runThreadless(
  payload: ThreadlessRunReqVO,
  options: RunThreadlessOptions = {}
): Promise<ApiResponse<ThreadlessRunRespVO>> {
  const url = `${configManager.getBaseUrl()}/gateway/threadless/run`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: options.signal
    });
    return (await response.json()) as ApiResponse<ThreadlessRunRespVO>;
  } catch (err) {
    // fetch 在请求被 abort 时会抛 AbortError；统一归一成 ApiResponse
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
