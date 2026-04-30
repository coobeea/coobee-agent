/**
 * Threadless HTTP 路由
 *
 * 提供一次性（无会话）Agent 调用的 REST HTTP 端点，供前端通用 AI 能力
 * （如输入框润色、摘要、翻译等）统一复用。
 *
 * 端点：
 *   POST /gateway/threadless/run — 同步调用，返回最终文本
 *
 * 设计：
 *   - 通信协议使用 HTTP（非 WebSocket RPC）。Threadless 场景是一次请求、一次响应，
 *     无需监听任何 stream:* 事件，不依赖 WS 连接状态。
 *   - 底层委托给 ThreadlessExecutor.runMessage，它会把流式 chunk 聚合成字符串。
 *   - 响应统一使用 ApiResponse<T> 契约。
 *   - 不创建持久化 Thread，不写入 chatStore。
 */

import type Router from '@koa/router';
import { createLogger } from '@main/common/logger';
import { ThreadlessExecutor } from '@main/agent/ThreadlessExecutor';
import type {
  ApiResponse,
  ThreadlessRunReqVO,
  ThreadlessRunRespVO,
  ThreadlessRuntimeType,
  ThreadlessMode
} from '@shared/api/threadless-types';

const log = createLogger('threadless-routes');

const RUNTIME_TYPES = new Set<ThreadlessRuntimeType>(['pi-mono', 'openai', 'claude']);
const MODES = new Set<ThreadlessMode>(['chat', 'agent']);

/**
 * 将输入值归一为受支持的 runtimeType，否则返回 undefined。
 */
function toRuntimeType(value: unknown): ThreadlessRuntimeType | undefined {
  return typeof value === 'string' && RUNTIME_TYPES.has(value as ThreadlessRuntimeType)
    ? (value as ThreadlessRuntimeType)
    : undefined;
}

/**
 * 将输入值归一为受支持的 mode，否则返回 undefined。
 */
function toMode(value: unknown): ThreadlessMode | undefined {
  return typeof value === 'string' && MODES.has(value as ThreadlessMode) ? (value as ThreadlessMode) : undefined;
}

export function registerThreadlessRoutes(router: Router): void {
  /**
   * POST /gateway/threadless/run
   *
   * 请求体：ThreadlessRunReqVO
   * 响应体：ApiResponse<ThreadlessRunRespVO>
   */
  router.post('/threadless/run', async (ctx) => {
    const body = (ctx.request.body ?? {}) as Partial<ThreadlessRunReqVO>;

    // 参数校验
    if (!body.message || typeof body.message !== 'string' || body.message.trim() === '') {
      ctx.status = 400;
      const response: ApiResponse = {
        success: false,
        error: 'message is required and must be a non-empty string'
      };
      ctx.body = response;
      return;
    }

    if (body.runtimeType !== undefined && !toRuntimeType(body.runtimeType)) {
      ctx.status = 400;
      const response: ApiResponse = {
        success: false,
        error: `runtimeType must be one of: pi-mono, openai, claude`
      };
      ctx.body = response;
      return;
    }

    if (body.mode !== undefined && !toMode(body.mode)) {
      ctx.status = 400;
      const response: ApiResponse = {
        success: false,
        error: `mode must be one of: chat, agent`
      };
      ctx.body = response;
      return;
    }

    const agentId = typeof body.agentId === 'string' && body.agentId.trim() !== '' ? body.agentId : 'app-copilot';
    const instructions =
      typeof body.instructions === 'string' && body.instructions.trim() !== '' ? body.instructions : undefined;
    const modelOverride =
      typeof body.modelOverride === 'string' && body.modelOverride.trim() !== '' ? body.modelOverride : undefined;
    const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim() !== '' ? body.sessionId : undefined;
    const lightweight = typeof body.lightweight === 'boolean' ? body.lightweight : undefined;
    const maxTurns =
      typeof body.maxTurns === 'number' && Number.isFinite(body.maxTurns) && body.maxTurns > 0
        ? Math.floor(body.maxTurns)
        : undefined;

    try {
      log.info(
        `[ThreadlessRoutes] run: agentId=${agentId}, messageLength=${body.message.length}, hasInstructions=${!!instructions}`
      );

      const text = await ThreadlessExecutor.runMessage({
        agentId,
        message: body.message,
        instructions,
        modelOverride,
        runtimeType: toRuntimeType(body.runtimeType),
        mode: toMode(body.mode),
        lightweight,
        maxTurns,
        sessionId
      });

      const response: ApiResponse<ThreadlessRunRespVO> = {
        success: true,
        data: {
          text,
          sessionId
        }
      };

      ctx.body = response;
    } catch (error) {
      log.error('[ThreadlessRoutes] run failed:', error);
      ctx.status = 500;

      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };

      ctx.body = response;
    }
  });

  log.info('[ThreadlessRoutes] HTTP 路由注册完成');
}
