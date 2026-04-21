/**
 * Chat RPC 方法组
 *
 * 提供 Thread 和消息管理的 WebSocket RPC 接口。
 *
 * 方法列表：
 *   chat.createThread  — 创建新会话
 *   chat.listThreads   — 列出所有会话
 *   chat.getThread     — 获取会话详情
 *   chat.sendMessage   — 发送消息并启动流式处理
 *   chat.abortMessage  — 中止当前消息执行
 */

import type { MethodGroup } from '@main/common/gateway/types';
import { GatewayErrorCode, GatewayMethodError } from '@main/common/gateway/errors';
import { ThreadStore } from '@main/agent/threads/ThreadStore';
import { agentExecutor } from '@main/agent/AgentExecutor';
import { createLogger } from '@main/common/logger';

const log = createLogger('chat-methods');

export const chatMethods: MethodGroup = {
  namespace: 'chat',

  methods: {
    /**
     * 创建新会话
     *
     * @param params.title - 会话标题
     * @param params.agentId - Agent ID（默认 'app-copilot'）
     * @param params.overrideModel - 覆盖模型（可选）
     * @returns ThreadDefinition
     */
    createThread: async (params) => {
      const { title, agentId = 'app-copilot', overrideModel } = params;

      const store = await ThreadStore.getInstance();
      const thread = await store.create({
        title: (title as string) || '新会话',
        agentId: agentId as string,
        overrideModel: overrideModel as string | undefined
      });

      log.info(`创建会话: ${thread.id}, agentId=${thread.agentId}`);
      return thread;
    },

    /**
     * 列出所有会话
     *
     * @returns { threads: ThreadIndexEntry[] }
     */
    listThreads: async () => {
      const store = await ThreadStore.getInstance();
      const threads = await store.list();

      log.debug(`列出会话: ${threads.length} 个`);
      return { threads };
    },

    /**
     * 获取会话详情
     *
     * @param params.id - 会话 ID
     * @returns ThreadDefinition
     * @throws NOT_FOUND - 会话不存在
     */
    getThread: async (params) => {
      const { id } = params;

      if (!id) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'id is required');
      }

      const store = await ThreadStore.getInstance();
      const thread = await store.get(id as string);

      if (!thread) {
        throw new GatewayMethodError(GatewayErrorCode.NOT_FOUND, 'Thread not found');
      }

      log.debug(`获取会话: ${thread.id}`);
      return thread;
    },

    /**
     * 发送消息并启动流式处理
     *
     * @param params.threadId - 会话 ID
     * @param params.message - 消息内容
     * @returns { success: true }
     * @throws INVALID_PARAMS - 参数错误
     * @throws NOT_FOUND - 会话不存在
     *
     * 流式输出通过 WebSocket 事件推送：
     *   - stream:start
     *   - stream:message
     *   - stream:end
     */
    sendMessage: async (params, _ctx) => {
      const { threadId, message } = params;

      if (!message || typeof message !== 'string' || message.trim() === '') {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'message is required');
      }

      if (!threadId) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'threadId is required');
      }

      const store = await ThreadStore.getInstance();
      const thread = await store.get(threadId as string);

      if (!thread) {
        throw new GatewayMethodError(GatewayErrorCode.NOT_FOUND, 'Thread not found');
      }

      log.info(`发送消息: threadId=${threadId}, message="${message.substring(0, 50)}..."`);

      // 1. 从 Thread 加载 Agent 配置
      const { AgentStore } = await import('@main/agent/agents');
      const agentStore = await AgentStore.getInstance();
      const agent = await agentStore.get(thread.agentId);

      if (!agent) {
        throw new GatewayMethodError(GatewayErrorCode.NOT_FOUND, `Agent not found: ${thread.agentId}`);
      }

      // 2. 创建 Builder
      const builder = agentExecutor.piMono().sessionMode('file').name(agent.id);

      // 应用 Agent 配置
      // 如果指定了模型，通过 ProviderInjector 重新注入配置（会正确解析 providerId/modelId）
      const modelSpec = thread.overrideModel || agent.model;
      if (modelSpec) {
        agentExecutor.applyProviderConfig(builder, { modelOverride: modelSpec });
      }

      if (agent.instructions) {
        builder.instructions(agent.instructions);
      }

      // 3. 启动流式执行（Agent 结果会通过 WebSocket 事件推送）
      const gen = agentExecutor.stream({
        sessionId: thread.id,
        message: message as string,
        builder
      });

      // 4. 异步消费流（触发 WebSocket 事件推送）
      (async () => {
        try {
          for await (const _chunk of gen) {
            // WebSocket 事件已由 EventBridge 自动推送，这里无需处理
          }
        } catch (error) {
          log.error(`[ChatMethods] 流式执行失败: threadId=${threadId}`, error);
          // 打印详细错误堆栈
          if (error instanceof Error) {
            log.error(`[ChatMethods] Error stack:`, error.stack);
          }
        }
      })();

      return { success: true };
    },

    /**
     * 中止当前消息执行
     *
     * @param params.threadId - 会话 ID
     * @returns { success: boolean, aborted: boolean }
     * @throws INVALID_PARAMS - 参数错误
     */
    abortMessage: async (params) => {
      const { threadId } = params;

      if (!threadId) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'threadId is required');
      }

      log.info(`中止消息: threadId=${threadId}`);

      const aborted = agentExecutor.abort(threadId as string);

      return {
        success: true,
        aborted
      };
    }
  }
};
