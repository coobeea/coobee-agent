/**
 * Chat Store
 *
 * 全局管理所有 thread 的消息。
 * 应用启动时自动监听流式消息并聚合存储。
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { StreamMessage } from '@shared/stream-protocol';
import type { ContentBlock, StreamChatMessage } from '@/types/chat';
import { nanoid } from 'nanoid';

/** Thread 消息状态 */
interface ThreadMessageState {
  /** 聚合后的消息列表 */
  messages: StreamChatMessage[];
  /** 当前正在构建的 assistant 消息 */
  currentAssistantMsg: StreamChatMessage | null;
}

const MAX_MESSAGES_PER_THREAD = 50;

type ToolBlock = Extract<ContentBlock, { type: 'tool' }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getToolArguments(data?: Record<string, unknown>): unknown {
  if (!data) return undefined;
  if (data.arguments !== undefined) return data.arguments;
  if (data.toolArgs !== undefined) return data.toolArgs;

  const details = data.details;
  if (isRecord(details) && details.args !== undefined) {
    return details.args;
  }
  return undefined;
}

function getToolUpdateContent(msg: StreamMessage, data?: Record<string, unknown>): string {
  if (typeof data?.delta === 'string') return data.delta;
  if (msg.content) return msg.content;

  const details = data?.details;
  const partialResult = isRecord(details) ? details.partialResult : undefined;
  if (isRecord(partialResult) && typeof partialResult.content === 'string') {
    return partialResult.content;
  }
  if (typeof partialResult === 'string') return partialResult;
  if (partialResult != null) {
    try {
      return JSON.stringify(partialResult);
    } catch {
      return String(partialResult);
    }
  }
  return '';
}

function findToolBlock(message: StreamChatMessage, data?: Record<string, unknown>): ToolBlock | undefined {
  const blocks = message.blocks;
  const callId = typeof data?.callId === 'string' ? data.callId : undefined;
  if (callId) {
    const byCallId = [...blocks].reverse().find((block) => block.type === 'tool' && block.tool.callId === callId);
    if (byCallId?.type === 'tool') return byCallId;
  }

  const toolName = typeof data?.toolName === 'string' ? data.toolName : undefined;
  if (toolName) {
    const byName = [...blocks]
      .reverse()
      .find((block) => block.type === 'tool' && block.tool.name === toolName && block.tool.status === 'calling');
    if (byName?.type === 'tool') return byName;
  }

  const latestCalling = [...blocks].reverse().find((block) => block.type === 'tool' && block.tool.status === 'calling');
  if (latestCalling?.type === 'tool') return latestCalling;

  const latestTool = [...blocks].reverse().find((block) => block.type === 'tool');
  return latestTool?.type === 'tool' ? latestTool : undefined;
}

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

          const data = msg.data as Record<string, unknown> | undefined;
          threadState.currentAssistantMsg.blocks.push({
            type: 'tool',
            tool: {
              name: (data?.toolName as string) || msg.content,
              callId: data?.callId as string | undefined,
              arguments: getToolArguments(data),
              status: 'calling'
            }
          });
          break;
        }

        case 'tool:pending': {
          // 工具参数准备完成，回填到最近的 calling 工具块
          if (!threadState.currentAssistantMsg) break;

          const data = msg.data as Record<string, unknown> | undefined;
          const block = findToolBlock(threadState.currentAssistantMsg, data);
          if (block) {
            const args = getToolArguments(data);
            if (args !== undefined) {
              block.tool.arguments = args;
            }
          }
          break;
        }

        case 'tool:delta': {
          // 工具执行过程输出，作为工具卡片的实时摘要素材
          if (!threadState.currentAssistantMsg) break;

          const data = msg.data as Record<string, unknown> | undefined;
          const block = findToolBlock(threadState.currentAssistantMsg, data);
          if (block) {
            const args = getToolArguments(data);
            if (args !== undefined && block.tool.arguments === undefined) {
              block.tool.arguments = args;
            }

            const content = getToolUpdateContent(msg, data);
            if (content) {
              const updateType = (data?.updateType as string) === 'output' ? 'output' : 'progress';
              block.tool.updates = block.tool.updates || [];
              block.tool.updates.push({
                type: updateType,
                content,
                timestamp: msg.timestamp || Date.now()
              });
            }
          }
          break;
        }

        case 'tool:done': {
          // 工具调用完成
          if (!threadState.currentAssistantMsg) break;

          // 统计工具调用次数
          if (threadState.currentAssistantMsg.stats) {
            threadState.currentAssistantMsg.stats.toolCalls++;
          }

          const data = msg.data as Record<string, unknown> | undefined;
          const suspended = data?.suspended === true;
          const block = findToolBlock(threadState.currentAssistantMsg, data);
          if (block) {
            const doneArguments = getToolArguments(data);
            if (doneArguments !== undefined) {
              block.tool.arguments = doneArguments;
            }
            block.tool.result =
              data?.output ?? (msg.content && msg.content !== block.tool.name ? msg.content : undefined);
            block.tool.status = suspended ? 'approval-pending' : 'done';
          }
          break;
        }

        case 'llm:done': {
          // LLM 调用完成，累计 token 统计
          if (!threadState.currentAssistantMsg || !threadState.currentAssistantMsg.stats) break;

          const usage = msg.data?.usage as
            | { inputTokens?: number; outputTokens?: number; totalTokens?: number; contextWindow?: number }
            | undefined;
          if (usage) {
            const stats = threadState.currentAssistantMsg.stats;
            const inputTokens = usage.inputTokens || 0;
            stats.inputTokens += inputTokens;
            stats.outputTokens += usage.outputTokens || 0;
            stats.totalTokens += usage.totalTokens || 0;
            stats.contextInputTokens = inputTokens;
            if (usage.contextWindow) {
              stats.contextWindow = usage.contextWindow;
            }
            stats.llmCalls++;
          }
          break;
        }

        case 'compression:start': {
          if (!threadState.currentAssistantMsg) break;

          threadState.currentAssistantMsg.blocks.push({
            type: 'compression',
            compression: {
              status: 'compressing',
              reason: msg.content || undefined
            }
          });
          break;
        }

        case 'compression:done': {
          if (!threadState.currentAssistantMsg) break;

          const lastBlock = threadState.currentAssistantMsg.blocks.at(-1);
          if (lastBlock && lastBlock.type === 'compression') {
            const hasError = msg.data?.error || msg.content?.toLowerCase().includes('error');
            lastBlock.compression.status = hasError ? 'error' : 'done';
            if (hasError) {
              lastBlock.compression.error = (msg.data?.error as string) || msg.content || undefined;
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
