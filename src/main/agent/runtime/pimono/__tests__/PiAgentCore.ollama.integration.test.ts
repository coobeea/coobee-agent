/**
 * @mariozechner/pi-agent-core + Ollama(OpenAI 兼容) 集成测试
 *
 * 目标：
 * 1. 演示如何用原生 pi-agent-core 直接接 Ollama 的 OpenAI 兼容接口
 * 2. 验证最小对话流程可以跑通
 * 3. 验证 sessionId + continue() 可以基于现有 transcript 续跑
 * 4. 验证 tool calling 在支持工具调用的 Ollama 模型上可跑通
 *
 * 说明：
 * - 不经过 PiMonoAgentRuntime / PiMonoBuilder 封装层
 * - 使用 @mariozechner/pi-ai 的 openai-completions 模型定义
 * - 默认跳过；只有显式设置 RUN_OLLAMA_TESTS=1 才会运行
 *
 * 环境变量：
 * - RUN_OLLAMA_TESTS=1
 * - RUN_OLLAMA_TOOL_TESTS=1   // 可选，仅在模型支持 tool calling 时启用
 * - OLLAMA_BASE_URL=http://localhost:11434/v1
 * - OLLAMA_MODEL=qwen2.5:7b
 * - OLLAMA_API_KEY=ollama   // 可选，未设置时使用 dummy 值
 *
 * 运行示例：
 *   RUN_OLLAMA_TESTS=1 \
 *   OLLAMA_BASE_URL=http://localhost:11434/v1 \
 *   OLLAMA_MODEL=qwen2.5:7b \
 *   pnpm exec vitest run src/main/agent/runtime/pimono/__tests__/PiAgentCore.ollama.integration.test.ts
 */

import { describe, expect, it } from 'vitest';

import { Agent, type AgentEvent, type AgentMessage, type AgentTool } from '@mariozechner/pi-agent-core';
import { Type, type Message, type Model } from '@mariozechner/pi-ai';

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

function createOllamaModel(): Model<'openai-completions'> {
  return {
    id: process.env.OLLAMA_MODEL || 'qwen2.5:7b',
    name: `Ollama ${process.env.OLLAMA_MODEL || 'qwen2.5:7b'}`,
    api: 'openai-completions',
    provider: 'ollama',
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false
    }
  };
}

const RUN = process.env.RUN_OLLAMA_TESTS === '1';
const RUN_TOOL_TESTS = process.env.RUN_OLLAMA_TOOL_TESTS === '1';
const describeIf = RUN ? describe : describe.skip;
const itToolIf = RUN_TOOL_TESTS ? it : it.skip;

describeIf('pi-agent-core ollama integration', () => {
  it('Agent.prompt(): 能通过 Ollama 的 OpenAI 兼容接口完成最小对话', async () => {
    const agent = new Agent({
      initialState: {
        systemPrompt: '你是一个简洁的测试助手，请用一句中文回复。',
        model: createOllamaModel(),
        thinkingLevel: 'off',
        messages: []
      },
      convertToLlm: convertAgentMessagesToLlm,
      getApiKey: () => process.env.OLLAMA_API_KEY || 'ollama'
    });

    await agent.prompt('请只回复“已连接”。');
    await agent.waitForIdle();

    const lastAssistant = agent.state.messages.findLast((message) => message.role === 'assistant');
    const output = readTextContent(lastAssistant);

    expect(output.length).toBeGreaterThan(0);
    expect(lastAssistant?.role).toBe('assistant');
  });

  it('Agent sessionId + continue(): 能带着会话标识续跑第二轮', async () => {
    const agent = new Agent({
      initialState: {
        systemPrompt: '你是一个会话测试助手，请保持简洁。',
        model: createOllamaModel(),
        thinkingLevel: 'off',
        messages: []
      },
      sessionId: 'pi-agent-core-ollama-session-demo',
      convertToLlm: convertAgentMessagesToLlm,
      getApiKey: () => process.env.OLLAMA_API_KEY || 'ollama'
    });

    await agent.prompt('第一轮：请回复“第一轮完成”。');
    await agent.waitForIdle();

    const firstRoundOutput = readTextContent(agent.state.messages.findLast((message) => message.role === 'assistant'));
    expect(firstRoundOutput.length).toBeGreaterThan(0);

    agent.state.messages = [
      ...agent.state.messages,
      {
        role: 'user',
        content: [{ type: 'text', text: '第二轮：请基于上文继续，并明确说这是第二轮。' }],
        timestamp: Date.now()
      }
    ];

    await agent.continue();
    await agent.waitForIdle();

    const finalAssistant = agent.state.messages.findLast((message) => message.role === 'assistant');
    const output = readTextContent(finalAssistant);

    expect(output.length).toBeGreaterThan(0);
    expect(output).toMatch(/第二轮|继续/);
  });

  itToolIf('Agent.prompt(): 在支持 tool calling 的 Ollama 模型上能完成工具调用闭环', async () => {
    const events: AgentEvent[] = [];
    const agent = new Agent({
      initialState: {
        systemPrompt: '你是工具测试助手。用户让你调用 echo 工具时，请调用它。',
        model: createOllamaModel(),
        thinkingLevel: 'off',
        tools: [echoTool],
        messages: []
      },
      convertToLlm: convertAgentMessagesToLlm,
      getApiKey: () => process.env.OLLAMA_API_KEY || 'ollama'
    });

    const unsubscribe = agent.subscribe((event) => {
      events.push(event);
    });

    await agent.prompt('请调用 echo 工具，并传入文本“来自 Ollama 工具测试”。');
    await agent.waitForIdle();
    unsubscribe();

    const toolStartEvent = events.find((event) => isEventOfType(event, 'tool_execution_start'));
    const toolEndEvent = events.find((event) => isEventOfType(event, 'tool_execution_end'));
    const finalAssistant = agent.state.messages.findLast((message) => message.role === 'assistant');
    const output = readTextContent(finalAssistant);

    expect(toolStartEvent).toBeDefined();
    expect(toolStartEvent?.toolName).toBe('echo');
    expect(toolEndEvent).toBeDefined();
    expect(toolEndEvent?.isError).toBe(false);
    expect(toolEndEvent?.result.details).toEqual({ echoed: '来自 Ollama 工具测试' });
    expect(output.length).toBeGreaterThan(0);
  });
});
