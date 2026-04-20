/**
 * ChunkProcessor — 流式块处理工具
 *
 * 从 AgentExecutor 提取的 stateless 工具，负责：
 *   - 指标采集：从 llm:done / compression:done / tool:done 提取数据写入 MetricsCollector
 *   - Extension Hook 触发：turn:start / turn:done / compression:start / compression:done
 *   - suspendReason 解析：从 tool:done 的 suspendReason 解析出 pendingOperation
 *
 * 设计：纯函数/静态方法，无状态，可被 AgentExecutor、consumeAndForward 等复用。
 */

import { createLogger } from '@main/common/logger';
// import { getMetricsCollector } from '@main/metrics/MetricsCollector'; // 最小化模式下禁用
import type { StreamChunk } from './types';

const log = createLogger('ai');

/** Turn 状态（用于 turn_end 等 Hook 参数） */
export interface ChunkProcessorTurnState {
  getTurnStartTime: () => number;
  getTurnToolCallCount: () => number;
}

// ==================== 指标采集 ====================

/**
 * 从 stream chunk 中提取 token 用量和压缩事件，写入 MetricsCollector
 * fire-and-forget，不影响流式响应
 *
 * 最小化模式：禁用指标采集
 */
export function recordMetrics(_chunk: StreamChunk, _sessionId: string): void {
  // 最小化模式下禁用指标采集
}

// ==================== Extension Hook ====================

/**
 * 根据 StreamChunk 类型触发对应的 Extension Hook
 *
 * 全部 fire-and-forget（不阻塞流式输出）。
 *
 * before_compaction：
 *   - 在此仅作为通知（PiMono 的 SDK 内置压缩无法拦截）
 *   - OpenAI Runtime 在 compressSessionWithChunks 中单独处理 modifying 逻辑
 *   - 为避免重复触发，OpenAI 会在 chunk.data 中标记 hookHandled: true
 */
export function fireHooks(
  chunk: StreamChunk,
  sessionId: string,
  turnState: ChunkProcessorTurnState,
  agentId?: string
): void {
  // 只关心这 4 种事件类型
  if (
    chunk.type !== 'turn:start' &&
    chunk.type !== 'turn:done' &&
    chunk.type !== 'compression:start' &&
    chunk.type !== 'compression:done'
  ) {
    return;
  }

  const fire = async (): Promise<void> => {
    const { ExtensionManager } = await import('@main/common/extension');
    const runner = ExtensionManager.getHookRunner();
    if (!runner) return;

    const data = chunk.data as Record<string, unknown> | undefined;

    switch (chunk.type) {
      case 'turn:start':
        await runner.runVoidHook('turn_start', {
          sessionId,
          turnIndex: (data?.turnIndex as number) || 1
        });
        break;

      case 'turn:done':
        await runner.runVoidHook('turn_end', {
          sessionId,
          turnIndex: (data?.turnIndex as number) || 1,
          durationMs: Date.now() - turnState.getTurnStartTime(),
          toolCallCount: turnState.getTurnToolCallCount()
        });
        break;

      case 'compression:start': {
        // 如果 OpenAI Runtime 已在压缩前调用过 modifying Hook，跳过
        if (data?.hookHandled) break;
        await runner.run('before_compaction', {
          sessionId,
          agentId: agentId || (data?.agentId as string | undefined),
          messageCount: 0,
          totalTokens: (data?.totalTokens as number) || 0,
          threshold: (data?.threshold as number) || 0
        });
        break;
      }

      case 'compression:done': {
        await runner.runVoidHook('after_compaction', {
          sessionId,
          originalTokens: (data?.originalTokens as number) || 0,
          compressedTokens: (data?.summaryTokens as number) || 0,
          compressionRatio: (data?.compressionRatio as number) || 0,
          duration: (data?.duration as number) || 0
        });
        break;
      }
    }
  };

  // Fire-and-forget：Hook 执行不阻塞流式输出
  fire().catch((err) => {
    log.warn(`[ChunkProcessor] Chunk hook failed for ${chunk.type}:`, err);
  });
}
