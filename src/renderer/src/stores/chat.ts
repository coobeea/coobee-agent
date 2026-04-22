/**
 * Chat Store
 *
 * 全局管理所有 thread 的消息。
 * 应用启动时自动监听流式消息并聚合存储。
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { StreamMessage } from '@shared/stream-protocol';
import type { StreamChatMessage } from '@/types/chat';
import { nanoid } from 'nanoid';

/** Thread 消息状态 */
interface ThreadMessageState {
  /** 聚合后的消息列表 */
  messages: StreamChatMessage[];
  /** 当前正在构建的 assistant 消息 */
  currentAssistantMsg: StreamChatMessage | null;
}

const MAX_MESSAGES_PER_THREAD = 50;

export const useChatStore = defineStore(
  'chat',
  () => {
    /** 各 thread 的消息状态 */
    const threadMessageStates = ref<Map<string, ThreadMessageState>>(new Map());

    /**
     * 获取或创建 thread 的消息状态
     */
    function getOrCreateThreadState(threadId: string): ThreadMessageState {
      if (!threadMessageStates.value.has(threadId)) {
        threadMessageStates.value.set(threadId, {
          messages: [],
          currentAssistantMsg: null
        });
      }
      return threadMessageStates.value.get(threadId)!;
    }

    /**
     * 添加用户消息
     */
    function addUserMessage(threadId: string, content: string): void {
      const threadState = getOrCreateThreadState(threadId);
      const userMsg: StreamChatMessage = {
        id: `msg-user-${nanoid(8)}`,
        role: 'user',
        content,
        blocks: [],
        status: 'done',
        timestamp: Date.now()
      };
      threadState.messages.push(userMsg);
      trimMessages(threadId);
    }

    /**
     * 处理流式消息（全局监听入口）- 聚合版本
     */
    function handleStreamMessage(msg: StreamMessage): void {
      const sessionId = msg.sessionId;
      const threadState = getOrCreateThreadState(sessionId);

      switch (msg.type) {
        case 'run:start': {
          // 创建新的 assistant 消息
          // 使用消息的时间戳（如果有）或当前时间
          const startTimestamp = msg.timestamp || Date.now();
          threadState.currentAssistantMsg = {
            id: `msg-assistant-${nanoid(8)}`,
            role: 'assistant',
            content: '',
            blocks: [],
            status: 'streaming',
            timestamp: startTimestamp,
            stats: {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              llmCalls: 0,
              toolCalls: 0,
              startTime: startTimestamp
            }
          };
          threadState.messages.push(threadState.currentAssistantMsg);
          break;
        }

        case 'text:delta': {
          // 累加文本到当前消息和 text block
          if (!threadState.currentAssistantMsg) break;

          threadState.currentAssistantMsg.content += msg.content || '';

          // 同时更新 text block（前端通过 blocks 渲染）
          const lastBlock = threadState.currentAssistantMsg.blocks.at(-1);
          if (lastBlock && lastBlock.type === 'text') {
            lastBlock.text += msg.content || '';
          } else {
            threadState.currentAssistantMsg.blocks.push({
              type: 'text',
              text: msg.content || ''
            });
          }
          break;
        }

        case 'reasoning:delta': {
          // 思考过程（累积到 thinking block）
          if (!threadState.currentAssistantMsg) break;

          const lastBlock = threadState.currentAssistantMsg.blocks.at(-1);
          if (lastBlock && lastBlock.type === 'thinking') {
            lastBlock.text += msg.content || '';
          } else {
            threadState.currentAssistantMsg.blocks.push({
              type: 'thinking',
              text: msg.content || ''
            });
          }
          break;
        }

        case 'tool:start': {
          // 工具调用开始
          if (!threadState.currentAssistantMsg) break;

          threadState.currentAssistantMsg.blocks.push({
            type: 'tool',
            tool: {
              name: (msg.data?.toolName as string) || msg.content,
              arguments: (msg.data?.arguments as string) || '',
              status: 'calling'
            }
          });
          break;
        }

        case 'tool:done': {
          // 工具调用完成
          if (!threadState.currentAssistantMsg) break;

          // 统计工具调用次数
          if (threadState.currentAssistantMsg.stats) {
            threadState.currentAssistantMsg.stats.toolCalls++;
          }

          const suspended = (msg.data as any)?.suspended === true;

          // 从后往前找到最后一个 calling 状态的工具
          for (let i = threadState.currentAssistantMsg.blocks.length - 1; i >= 0; i--) {
            const block = threadState.currentAssistantMsg.blocks[i];
            if (block.type === 'tool' && block.tool.status === 'calling') {
              block.tool.result = msg.content;
              block.tool.status = suspended ? 'approval-pending' : 'done';
              break;
            }
          }
          break;
        }

        case 'llm:done': {
          // LLM 调用完成，累计 token 统计
          if (!threadState.currentAssistantMsg || !threadState.currentAssistantMsg.stats) break;

          const usage = msg.data?.usage as
            | { inputTokens?: number; outputTokens?: number; totalTokens?: number }
            | undefined;
          if (usage) {
            const stats = threadState.currentAssistantMsg.stats;
            stats.inputTokens += usage.inputTokens || 0;
            stats.outputTokens += usage.outputTokens || 0;
            stats.totalTokens += usage.totalTokens || 0;
            stats.llmCalls++;
          }
          break;
        }

        case 'delegate:start': {
          // 委派开始
          if (!threadState.currentAssistantMsg) break;

          threadState.currentAssistantMsg.blocks.push({
            type: 'delegate',
            delegate: {
              agentId: (msg.data?.agentId as string) || 'unknown',
              agentName: msg.data?.agentName as string | undefined,
              task: msg.data?.task as string | undefined,
              status: 'running'
            }
          });
          break;
        }

        case 'delegate:done': {
          // 委派完成
          if (!threadState.currentAssistantMsg) break;

          const agentId = msg.data?.agentId as string | undefined;
          // 从后往前找到对应的 delegate block
          for (let i = threadState.currentAssistantMsg.blocks.length - 1; i >= 0; i--) {
            const block = threadState.currentAssistantMsg.blocks[i];
            if (
              block.type === 'delegate' &&
              block.delegate.status === 'running' &&
              (!agentId || block.delegate.agentId === agentId)
            ) {
              block.delegate.status = 'done';
              block.delegate.output = msg.content || undefined;
              block.delegate.duration = msg.data?.duration as number | undefined;
              break;
            }
          }
          break;
        }

        case 'hitl:required': {
          // HITL 审批请求
          if (!threadState.currentAssistantMsg) break;

          const toolName = (msg.data?.toolName as string) || 'unknown';
          const approvalIndex = (msg.data?.index as number) ?? 0;
          const approvalSessionId = (msg.data?.subSessionId as string) || msg.sessionId;

          if (!threadState.currentAssistantMsg.pendingApprovals) {
            threadState.currentAssistantMsg.pendingApprovals = [];
          }
          threadState.currentAssistantMsg.pendingApprovals.push({
            index: approvalIndex,
            toolName,
            arguments: msg.data?.arguments as string | undefined,
            sessionId: approvalSessionId,
            canShow: false // 必须等到 run:done 后才显示
          });
          break;
        }

        case 'hitl:approved':
        case 'hitl:rejected': {
          // HITL 审批决策
          if (!threadState.currentAssistantMsg?.pendingApprovals) break;

          const targetIndex = msg.data?.index as number | undefined;
          const decision = msg.type === 'hitl:approved' ? 'approve-once' : 'reject';

          if (targetIndex != null) {
            const approval = threadState.currentAssistantMsg.pendingApprovals.find((a) => a.index === targetIndex);
            if (approval) {
              approval.decision = decision;
            }
          }
          break;
        }

        case 'quality:round_start':
        case 'quality:validating':
        case 'quality:score':
        case 'quality:repairing':
        case 'quality:done': {
          // 质量检查
          if (!threadState.currentAssistantMsg) break;

          const lastBlock = threadState.currentAssistantMsg.blocks.at(-1);
          if (lastBlock && lastBlock.type === 'quality') {
            lastBlock.status = msg.content;
            lastBlock.detail = msg.data ? JSON.stringify(msg.data) : undefined;
          } else {
            threadState.currentAssistantMsg.blocks.push({
              type: 'quality',
              status: msg.content,
              detail: msg.data ? JSON.stringify(msg.data) : undefined
            });
          }
          break;
        }

        case 'run:done': {
          // 标记消息完成
          if (threadState.currentAssistantMsg) {
            threadState.currentAssistantMsg.status = 'done';

            // 计算统计数据
            if (threadState.currentAssistantMsg.stats) {
              const stats = threadState.currentAssistantMsg.stats;
              // 使用消息的时间戳（如果有）或当前时间
              const endTimestamp = msg.timestamp || Date.now();
              stats.endTime = endTimestamp;
              stats.duration = stats.endTime - stats.startTime;

              // 计算输出速率（tokens/秒）
              if (stats.duration > 0 && stats.outputTokens > 0) {
                stats.tokensPerSecond = Math.round((stats.outputTokens / stats.duration) * 1000);
              }
            }

            // 在异步审批模式下，Agent run 正常结束，但审批可能还在等待中
            // run:done 后，标记所有 pending 的审批为可显示状态
            if (threadState.currentAssistantMsg.pendingApprovals) {
              for (const approval of threadState.currentAssistantMsg.pendingApprovals) {
                if (!approval.decision) {
                  approval.canShow = true;
                }
              }
            }
            threadState.currentAssistantMsg = null;
          }
          trimMessages(sessionId);
          break;
        }

        case 'run:error':
          // 标记消息错误
          if (threadState.currentAssistantMsg) {
            threadState.currentAssistantMsg.status = 'error';
            threadState.currentAssistantMsg.error = msg.content || '执行出错';
            threadState.currentAssistantMsg = null;
          }
          break;

        case 'run:interrupted':
          // 运行中断
          if (threadState.currentAssistantMsg) {
            threadState.currentAssistantMsg.status = 'interrupted';
          }
          break;

        case 'run:resumed':
          // 运行恢复
          if (threadState.currentAssistantMsg) {
            threadState.currentAssistantMsg.status = 'streaming';
          }
          break;

        default:
          break;
      }
    }

    /**
     * 限制消息数量
     */
    function trimMessages(threadId: string): void {
      const threadState = threadMessageStates.value.get(threadId);
      if (!threadState) return;

      if (threadState.messages.length > MAX_MESSAGES_PER_THREAD) {
        threadState.messages.shift(); // 删除最旧的
      }
    }

    /**
     * 获取 thread 的消息列表
     */
    function getThreadMessages(threadId: string): StreamChatMessage[] {
      const threadState = threadMessageStates.value.get(threadId);
      return threadState?.messages || [];
    }

    /**
     * 清空 thread 的消息
     */
    function clearThreadMessages(threadId: string): void {
      threadMessageStates.value.delete(threadId);
    }

    /**
     * 添加历史消息（用于加载历史记录）
     */
    function addHistoryMessage(threadId: string, message: StreamChatMessage): void {
      const threadState = getOrCreateThreadState(threadId);
      threadState.messages.push(message);
    }

    return {
      threadMessageStates,
      addUserMessage,
      addHistoryMessage,
      handleStreamMessage,
      getThreadMessages,
      clearThreadMessages
    };
  },
  {
    // 禁用持久化：streaming 状态是临时运行时状态，不应该持久化
    // 服务器重启后应该从后端重新同步状态
    persist: false
  }
);
