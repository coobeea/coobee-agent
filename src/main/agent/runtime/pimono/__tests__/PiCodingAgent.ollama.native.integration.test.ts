/**
 * @mariozechner/pi-coding-agent + Ollama(OpenAI 兼容) 原生集成测试
 *
 * 目标：
 * 1. 演示 pi-coding-agent SDK 的最小接入方式
 * 2. 演示单工具、多工具、会话续跑
 * 3. 演示原生 AgentSession 的手动 compaction
 *
 * 说明：
 * - 不经过 PiMonoAgentRuntime / PiMonoBuilder 封装层
 * - 使用 createAgentSession() + SessionManager.inMemory()
 * - 自定义资源加载器，避免扫描仓库里的 skills / prompts / extensions
 * - 默认跳过；只有显式设置环境变量时才运行
 *
 * 环境变量：
 * - RUN_OLLAMA_PI_NATIVE_TESTS=1
 * - RUN_OLLAMA_PI_TOOL_TESTS=1
 * - RUN_OLLAMA_PI_COMPACTION_TESTS=1
 * - OLLAMA_BASE_URL=http://localhost:11434/v1
 * - OLLAMA_MODEL=qwen2.5:7b
 * - OLLAMA_API_KEY=ollama
 *
 * 运行示例：
 *   RUN_OLLAMA_PI_NATIVE_TESTS=1 \
 *   RUN_OLLAMA_PI_TOOL_TESTS=1 \
 *   RUN_OLLAMA_PI_COMPACTION_TESTS=1 \
 *   OLLAMA_BASE_URL=http://localhost:11434/v1 \
 *   OLLAMA_MODEL=qwen2.5:7b \
 *   pnpm exec vitest run src/main/agent/runtime/pimono/__tests__/PiCodingAgent.ollama.native.integration.test.ts
 */

import { afterEach, describe, expect, it } from 'vitest';
import { Type } from '@sinclair/typebox';
import type { Model } from '@mariozechner/pi-ai';
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  createAgentSession,
  createExtensionRuntime,
  defineTool,
  type AgentSession,
  type AgentSessionEvent,
  type ResourceLoader,
  type ToolDefinition
} from '@mariozechner/pi-coding-agent';

const RUN = process.env.RUN_OLLAMA_PI_NATIVE_TESTS === '1';
const RUN_TOOL_TESTS = process.env.RUN_OLLAMA_PI_TOOL_TESTS === '1';
const RUN_COMPACTION_TESTS = process.env.RUN_OLLAMA_PI_COMPACTION_TESTS === '1';

const describeIf = RUN ? describe : describe.skip;
const itToolIf = RUN_TOOL_TESTS ? it : it.skip;
const itCompactionIf = RUN_COMPACTION_TESTS ? it : it.skip;

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || 'ollama';

const OPENAI_COMPAT_PROVIDER = 'ollama';

function createOllamaModel(): Model<'openai-completions'> {
  return {
    id: OLLAMA_MODEL,
    name: `Ollama ${OLLAMA_MODEL}`,
    api: 'openai-completions',
    provider: OPENAI_COMPAT_PROVIDER,
    baseUrl: OLLAMA_BASE_URL,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: true,
      maxTokensField: 'max_tokens'
    }
  };
}

function readAssistantText(session: AgentSession): string {
  const lastAssistant = [...session.agent.state.messages].reverse().find((message) => message.role === 'assistant');
  if (!lastAssistant || !Array.isArray(lastAssistant.content)) return '';
  return lastAssistant.content
    .filter(
      (block): block is Extract<(typeof lastAssistant.content)[number], { type: 'text' }> => block.type === 'text'
    )
    .map((block) => block.text)
    .join('');
}

function createStubResourceLoader(instructions: string): ResourceLoader {
  const runtime = createExtensionRuntime();
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] as Array<{ path: string; content: string }> }),
    getSystemPrompt: () => instructions,
    getAppendSystemPrompt: () => [],
    extendResources: () => {},
    reload: async () => {}
  };
}

async function createNativePiSession(options?: {
  instructions?: string;
  customTools?: ToolDefinition[];
  settings?: Parameters<typeof SettingsManager.inMemory>[0];
}): Promise<AgentSession> {
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(OPENAI_COMPAT_PROVIDER, OLLAMA_API_KEY);
  const modelRegistry = ModelRegistry.inMemory(authStorage);

  const { session } = await createAgentSession({
    cwd: process.cwd(),
    model: createOllamaModel(),
    thinkingLevel: 'minimal',
    noTools: 'builtin',
    customTools: options?.customTools,
    authStorage,
    modelRegistry,
    sessionManager: SessionManager.inMemory(process.cwd()),
    settingsManager: SettingsManager.inMemory(options?.settings || { compaction: { enabled: true } }),
    resourceLoader: createStubResourceLoader(
      options?.instructions || '你是一个简洁的测试助手，请严格遵守工具使用要求。'
    )
  });

  return session;
}

const sessions: AgentSession[] = [];

afterEach(async () => {
  for (const session of sessions) {
    session.dispose();
  }
  sessions.length = 0;
});

describeIf('pi-coding-agent ollama native usage', () => {
  it('basic: createAgentSession() 能完成最小对话', async () => {
    const session = await createNativePiSession({
      instructions: '你是一个简洁的测试助手，请只用一句中文回复。'
    });
    sessions.push(session);

    await session.prompt('请只回复“已连接”。');

    expect(readAssistantText(session)).toBeTruthy();
  });

  itToolIf('tool: 能完成单工具调用', async () => {
    const toolStartNames: string[] = [];

    const echoTool = defineTool({
      name: 'echo',
      label: 'Echo',
      description: '回显输入文本',
      parameters: Type.Object({
        text: Type.String({ description: '要回显的文本' })
      }),
      async execute(_toolCallId, params) {
        return {
          content: [{ type: 'text', text: `Echo: ${params.text}` }],
          details: { echoed: params.text }
        };
      }
    });

    const session = await createNativePiSession({
      instructions: '当用户要求回显文本时，必须调用 echo 工具。',
      customTools: [echoTool]
    });
    sessions.push(session);

    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      if (event.type === 'tool_execution_start') {
        toolStartNames.push(event.toolName);
      }
    });

    await session.prompt('请调用 echo 工具，回显“来自 pi-coding-agent”。');
    unsubscribe();

    expect(toolStartNames).toContain('echo');
    expect(readAssistantText(session)).toBeTruthy();
  });

  itToolIf('multi-tools: 能完成多工具调用', async () => {
    const toolStartNames: string[] = [];

    const addTool = defineTool({
      name: 'add_numbers',
      label: 'Add Numbers',
      description: '计算两个数字相加',
      parameters: Type.Object({
        a: Type.Number(),
        b: Type.Number()
      }),
      async execute(_toolCallId, params) {
        const result = params.a + params.b;
        return {
          content: [{ type: 'text', text: `${params.a} + ${params.b} = ${result}` }],
          details: { result }
        };
      }
    });

    const multiplyTool = defineTool({
      name: 'multiply_numbers',
      label: 'Multiply Numbers',
      description: '计算两个数字相乘',
      parameters: Type.Object({
        a: Type.Number(),
        b: Type.Number()
      }),
      async execute(_toolCallId, params) {
        const result = params.a * params.b;
        return {
          content: [{ type: 'text', text: `${params.a} * ${params.b} = ${result}` }],
          details: { result }
        };
      }
    });

    const session = await createNativePiSession({
      instructions: '当用户同时要求加法和乘法时，必须把两个工具都调用完，再总结结果。',
      customTools: [addTool, multiplyTool]
    });
    sessions.push(session);

    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      if (event.type === 'tool_execution_start') {
        toolStartNames.push(event.toolName);
      }
    });

    await session.prompt('请先算 8 + 13，再算 6 * 7。两个工具都要调用，最后一起汇总。');
    unsubscribe();

    expect(toolStartNames).toContain('add_numbers');
    expect(toolStartNames).toContain('multiply_numbers');
    expect(readAssistantText(session)).toBeTruthy();
  });

  it('session: 同一个 AgentSession 能基于已有上下文继续回答', async () => {
    const session = await createNativePiSession({
      instructions: '请基于已有上下文继续回答，保持简洁。'
    });
    sessions.push(session);

    await session.prompt('金门大桥在哪个城市？');
    const firstOutput = readAssistantText(session);

    await session.prompt('它在哪个州？');
    const secondOutput = readAssistantText(session);

    expect(firstOutput).toBeTruthy();
    expect(secondOutput).toBeTruthy();
    expect(session.agent.state.messages.length).toBeGreaterThan(0);
  });

  itCompactionIf('compaction: AgentSession.compact() 能完成原生手动压缩', async () => {
    const events: AgentSessionEvent[] = [];
    const session = await createNativePiSession({
      instructions: '请记录用户提到的所有关键信息，并在压缩时保留项目背景、技术栈和待办。',
      settings: {
        compaction: {
          enabled: true,
          reserveTokens: 512,
          keepRecentTokens: 256
        }
      }
    });
    sessions.push(session);

    const unsubscribe = session.subscribe((event) => {
      events.push(event);
    });

    await session.prompt(
      '项目背景：我们在做一个 Electron + Vue 3 + TypeScript 的桌面 Agent 应用，当前重点是 runtime 分层收敛。'
    );
    await session.prompt('技术栈补充：前端 Tailwind CSS 4，后端 Node.js，模型接入 OpenAI 兼容接口与 Ollama。');
    await session.prompt('当前待办：梳理 openai 和 pimono 的 native tests，覆盖基础对话、工具、多工具、会话和压缩。');

    const result = await session.compact('请保留项目背景、技术栈、当前待办。');
    unsubscribe();

    const compactionStart = events.find((event) => event.type === 'compaction_start');
    const compactionEnd = events.find((event) => event.type === 'compaction_end');

    expect(compactionStart).toBeDefined();
    expect(compactionEnd).toBeDefined();
    expect(compactionEnd && 'result' in compactionEnd ? compactionEnd.result : undefined).toBeDefined();
    expect(result).toBeTruthy();
  });
});
