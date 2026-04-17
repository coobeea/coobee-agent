/**
 * Stream Handler Composable
 *
 * 将后端 StreamMessage 转换为 UI 可渲染的 StreamChatMessage 结构。
 * 每个聊天组件独立维护自己的消息列表。
 */

import { ref, computed, nextTick } from 'vue';
import type { StreamMessage } from '@shared/stream-protocol';
import type { StreamChatMessage, ContentBlock, PendingApproval, ExecOutputEntry } from '@/types/chat';
import { nanoid } from 'nanoid';

// 导出类型供外部使用
export type { ContentBlock, PendingApproval, ExecOutputEntry };

export interface UseStreamHandlerOptions {
  /** ID 前缀 */
  idPrefix?: string;
  /** 最大消息数 */
  maxMessages?: number;
}

export function useStreamHandler(options: UseStreamHandlerOptions = {}) {
  const { idPrefix = 'msg', maxMessages = 500 } = options;

  /** 消息列表 */
  const messages = ref<StreamChatMessage[]>([]);

  /** 是否正在流式响应 */
  const isStreaming = ref(false);

  /** 当前 assistant 消息（用于追加内容） */
  let currentAssistantMsg: StreamChatMessage | null = null;

  /** 工具调用输出记录（toolName -> output） */
  const execOutputs = ref<Map<string, string>>(new Map());

  /**
   * 添加用户消息
   */
  function addUserMessage(content: string): void {
    const userMsg: StreamChatMessage = {
      id: `${idPrefix}-user-${nanoid(8)}`,
      role: 'user',
      content,
      blocks: [{ type: 'text', text: content }],
      status: 'done',
      timestamp: Date.now()
    };

    messages.value.push(userMsg);
    trimMessages();
  }

  /**
   * 创建新的 assistant 消息
   */
  function createAssistantMessage(): void {
    currentAssistantMsg = {
      id: `${idPrefix}-assistant-${nanoid(8)}`,
      role: 'assistant',
      blocks: [],
      status: 'streaming',
      timestamp: Date.now()
    };

    messages.value.push(currentAssistantMsg);
    isStreaming.value = true;
  }

  /**
   * 处理流式消息
   */
  function handleStreamMessage(msg: StreamMessage): void {
    switch (msg.type) {
      case 'run:start':
        // 新的 AI 回复开始
        createAssistantMessage();
        break;

      case 'reasoning:delta':
        // 思考过程（累积）
        if (!currentAssistantMsg) return;

        let thinkingBlock = currentAssistantMsg.blocks.find((b) => b.type === 'thinking');
        if (!thinkingBlock) {
          thinkingBlock = { type: 'thinking', text: '' };
          currentAssistantMsg.blocks.push(thinkingBlock);
        }
        thinkingBlock.text = (thinkingBlock.text || '') + msg.content;
        break;

      case 'tool:start':
        // 工具调用开始
        if (!currentAssistantMsg) return;

        currentAssistantMsg.blocks.push({
          type: 'tool',
          tool: {
            name: msg.data?.toolName as string | undefined,
            arguments: msg.data?.arguments as string | undefined,
            status: 'calling'
          }
        });
        break;

      case 'tool:done':
        // 工具调用完成
        if (!currentAssistantMsg) return;

        // 找到最后一个 calling 状态的 tool block
        const toolBlock = [...currentAssistantMsg.blocks]
          .reverse()
          .find((b) => b.type === 'tool' && b.tool?.status === 'calling');

        if (toolBlock?.tool) {
          toolBlock.tool.result = msg.content;
          toolBlock.tool.status = 'done';

          // 记录工具输出
          if (toolBlock.tool.name) {
            execOutputs.value.set(toolBlock.tool.name, msg.content);
          }
        }
        break;

      case 'tool:error':
        // 工具调用失败
        if (!currentAssistantMsg) return;

        const errorToolBlock = [...currentAssistantMsg.blocks]
          .reverse()
          .find((b) => b.type === 'tool' && b.tool?.status === 'calling');

        if (errorToolBlock?.tool) {
          errorToolBlock.tool.status = 'error';
          errorToolBlock.tool.error = msg.content;
        }
        break;

      case 'text:delta':
        // 文本内容（累积）
        if (!currentAssistantMsg) return;

        let textBlock = currentAssistantMsg.blocks.find(
          (b, idx) => b.type === 'text' && idx === currentAssistantMsg!.blocks.length - 1
        );

        if (!textBlock || textBlock.type !== 'text') {
          textBlock = { type: 'text', text: '' };
          currentAssistantMsg.blocks.push(textBlock);
        }

        textBlock.text = (textBlock.text || '') + msg.content;
        break;

      case 'run:done':
        // 回复完成
        if (currentAssistantMsg) {
          currentAssistantMsg.status = 'done';
          currentAssistantMsg = null;
        }
        isStreaming.value = false;
        break;

      case 'run:error':
        // 回复失败
        if (currentAssistantMsg) {
          currentAssistantMsg.status = 'error';

          // 添加错误块
          currentAssistantMsg.blocks.push({
            type: 'text',
            text: `错误: ${msg.content}`
          });

          currentAssistantMsg = null;
        }
        isStreaming.value = false;
        break;

      case 'hitl':
        // HITL 审批（预留）
        // TODO: 处理审批逻辑
        break;

      default:
        // 忽略其他类型
        break;
    }
  }

  /**
   * 限制消息数量
   */
  function trimMessages(): void {
    if (messages.value.length > maxMessages) {
      messages.value = messages.value.slice(-maxMessages);
    }
  }

  /**
   * 重置所有状态
   */
  function resetAll(): void {
    messages.value = [];
    currentAssistantMsg = null;
    isStreaming.value = false;
    execOutputs.value.clear();
  }

  /**
   * 滚动到底部
   */
  async function scrollToBottom(container?: HTMLElement): Promise<void> {
    await nextTick();
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }

  return {
    messages: computed(() => messages.value),
    isStreaming: computed(() => isStreaming.value),
    execOutputs: computed(() => execOutputs.value),
    addUserMessage,
    handleStreamMessage,
    resetAll,
    scrollToBottom
  };
}
