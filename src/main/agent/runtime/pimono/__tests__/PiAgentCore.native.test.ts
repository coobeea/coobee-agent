/**
 * @mariozechner/pi-agent-core 原生用法测试
 *
 * 目标：
 * 1. 直接演示 Agent.prompt() 的基本事件流
 * 2. 直接演示 agentLoop() + AgentTool 的工具调用闭环
 * 3. 直接演示 beforeToolCall / afterToolCall hook 的原生用法
 *
 * 说明：
 * - 不经过 PiMonoAgentRuntime / PiMonoBuilder 封装层
 * - 使用 @mariozechner/pi-ai 的 faux provider，保证测试稳定且无需真实 API key
 * - 这个文件本身也可以当成 pi-agent-core 的最小接入示例来读
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  Agent,
  agentLoop,
  type AfterToolCallContext,
  type AfterToolCallResult,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
  type BeforeToolCallContext
} from '@mariozechner/pi-agent-core';
import {
  Type,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  registerFauxProvider,
  streamSimple,
  type FauxProviderRegistration,
  type Message
} from '@mariozechner/pi-ai';

function convertAgentMessagesToLlm(messages: AgentMessage[]): Message[] {
  return messages.filter((message): message is Message => {
    return message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult';
  });
}

function readTextContent(message: AgentMessage | undefined): string {
  if (!message || !('content' in message) || !Array.isArray(message.content)) {
    return '';
  }

  return message.content
    .filter((block): block is Extract<(typeof message.content)[number], { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

function isEventOfType<TType extends AgentEvent['type']>(
  event: AgentEvent,
  type: TType
): event is Extract<AgentEvent, { type: TType }> {
  return event.type === type;
}

const echoToolParams = Type.Object({
  text: Type.String({ description: '需要回显的文本' })
});

const echoTool: AgentTool<typeof echoToolParams, { echoed: string }> = {
  name: 'echo',
  label: 'Echo',
  description: '回显输入文本',
  parameters: echoToolParams,
  async execute(_toolCallId, params) {
    return {
      content: [{ type: 'text', text: `Echo: ${params.text}` }],
      details: { echoed: params.text }
    };
  }
};

describe('pi-agent-core native usage', () => {
  let faux: FauxProviderRegistration;

  beforeEach(() => {
    faux = registerFauxProvider();
  });

  afterEach(() => {
    faux.unregister();
  });

  it('Agent.prompt(): 能完成最小对话并产出标准事件流', async () => {
    const model = faux.getModel();
    faux.setResponses([fauxAssistantMessage([fauxText('Faux: 收到。')])]);

    const events: AgentEvent[] = [];
    const agent = new Agent({
      initialState: {
        systemPrompt: '你是测试助手。',
        model,
        thinkingLevel: 'off',
        messages: []
      },
      convertToLlm: convertAgentMessagesToLlm
    });

    const unsubscribe = agent.subscribe((event) => {
      events.push(event);
    });

    await agent.prompt('你好');
    await agent.waitForIdle();
    unsubscribe();

    expect(events.some((event) => event.type === 'agent_start')).toBe(true);
    expect(events.some((event) => event.type === 'turn_start')).toBe(true);
    expect(events.some((event) => event.type === 'message_update')).toBe(true);

    const endEvent = events.find((event) => isEventOfType(event, 'agent_end'));
    expect(endEvent).toBeDefined();

    const lastAssistantMessage = endEvent?.messages.findLast((message) => message.role === 'assistant');
    expect(readTextContent(lastAssistantMessage)).toContain('Faux: 收到。');
  });

  it('agentLoop(): 能原生跑通 tool call -> tool result -> final assistant reply', async () => {
    const model = faux.getModel();
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('echo', { text: '来自 agentLoop' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxText('工具结果已收到。')])
    ]);

    const promptMessage: AgentMessage = {
      role: 'user',
      content: [{ type: 'text', text: '请调用 echo 工具' }],
      timestamp: Date.now()
    };

    const context = {
      systemPrompt: '你是工具测试助手。',
      messages: [],
      tools: [echoTool]
    };

    const stream = agentLoop(
      [promptMessage],
      context,
      {
        model,
        convertToLlm: convertAgentMessagesToLlm
      },
      undefined,
      streamSimple
    );

    const events: AgentEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }
    const finalMessages = await stream.result();

    const toolStartEvent = events.find((event) => isEventOfType(event, 'tool_execution_start'));
    const toolEndEvent = events.find((event) => isEventOfType(event, 'tool_execution_end'));

    expect(toolStartEvent?.toolName).toBe('echo');
    expect(toolStartEvent?.args).toEqual({ text: '来自 agentLoop' });

    expect(toolEndEvent).toBeDefined();
    expect(toolEndEvent?.isError).toBe(false);
    expect(toolEndEvent?.result.details).toEqual({ echoed: '来自 agentLoop' });
    expect(readTextContent(finalMessages.findLast((message) => message.role === 'assistant'))).toContain(
      '工具结果已收到。'
    );
  });

  it('Agent hooks: beforeToolCall / afterToolCall 能拿到原生上下文并修改工具结果', async () => {
    const model = faux.getModel();
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('echo', { text: 'hook payload' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxText('Hook 已完成。')])
    ]);

    const events: AgentEvent[] = [];
    const beforeToolCall = vi.fn(async ({ toolCall, args }: BeforeToolCallContext) => {
      expect(toolCall.name).toBe('echo');
      expect(args).toEqual({ text: 'hook payload' });
      return undefined;
    });

    const afterToolCall = vi.fn(async ({ result, isError }: AfterToolCallContext): Promise<AfterToolCallResult> => {
      expect(isError).toBe(false);
      return {
        content: [{ type: 'text' as const, text: 'Hooked: tool result' }],
        details: { ...(result.details as Record<string, unknown>), audited: true }
      };
    });

    const agent = new Agent({
      initialState: {
        systemPrompt: '你是 hook 测试助手。',
        model,
        thinkingLevel: 'off',
        tools: [echoTool],
        messages: []
      },
      convertToLlm: convertAgentMessagesToLlm,
      beforeToolCall,
      afterToolCall
    });

    const unsubscribe = agent.subscribe((event) => {
      events.push(event);
    });

    await agent.prompt('请执行 hook 测试');
    await agent.waitForIdle();
    unsubscribe();

    expect(beforeToolCall).toHaveBeenCalledTimes(1);
    expect(afterToolCall).toHaveBeenCalledTimes(1);

    const toolEndEvent = events.find((event) => isEventOfType(event, 'tool_execution_end'));
    expect(toolEndEvent).toBeDefined();
    expect(toolEndEvent?.result.content[0]?.text).toBe('Hooked: tool result');
    expect(toolEndEvent?.result.details).toEqual({
      echoed: 'hook payload',
      audited: true
    });
  });

  it('Agent sessionId + continue(): 会话标识会透传到底层，并可基于现有 transcript 继续执行', async () => {
    const model = faux.getModel();
    faux.setResponses([
      fauxAssistantMessage([fauxText('第一轮完成。')]),
      fauxAssistantMessage([fauxText('继续执行完成。')])
    ]);

    const seenSessionIds: Array<string | undefined> = [];
    const agent = new Agent({
      initialState: {
        systemPrompt: '你是 session 测试助手。',
        model,
        thinkingLevel: 'off',
        messages: []
      },
      sessionId: 'session-native-demo',
      convertToLlm: convertAgentMessagesToLlm,
      streamFn: (modelArg, contextArg, optionsArg) => {
        seenSessionIds.push(optionsArg?.sessionId);
        return streamSimple(modelArg, contextArg, optionsArg);
      }
    });

    await agent.prompt('先来一轮');
    await agent.waitForIdle();

    agent.state.messages = [
      ...agent.state.messages,
      {
        role: 'user',
        content: [{ type: 'text', text: '请基于当前上下文继续' }],
        timestamp: Date.now()
      }
    ];

    await agent.continue();
    await agent.waitForIdle();

    expect(seenSessionIds).toEqual(['session-native-demo', 'session-native-demo']);
    expect(readTextContent(agent.state.messages.findLast((message) => message.role === 'assistant'))).toContain(
      '继续执行完成。'
    );
  });
});
