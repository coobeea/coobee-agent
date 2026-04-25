/**
 * @openai/agents + Ollama(OpenAI 兼容) 原生集成测试
 *
 * 目标：
 * 1. 演示 @openai/agents 在 Ollama OpenAI 兼容接口上的最小用法
 * 2. 演示单工具、多工具、MemorySession 会话续跑
 * 3. 演示本仓库 openai 侧的 FileSession + SessionCompressor 压缩能力
 *
 * 说明：
 * - 基础对话 / 工具 / 多工具 / 会话：直接参考 openai-agents-js examples 的原生用法
 * - 会话压缩：Ollama 不支持 OpenAI Responses 的原生 compact API，这里改用本仓库的
 *   FileSession + SessionCompressor，仍然由 @openai/agents + Ollama 模型生成总结
 * - 默认跳过；只有显式设置环境变量时才运行
 *
 * 环境变量：
 * - RUN_OLLAMA_OPENAI_NATIVE_TESTS=1
 * - RUN_OLLAMA_OPENAI_TOOL_TESTS=1
 * - RUN_OLLAMA_OPENAI_COMPRESSION_TESTS=1
 * - OLLAMA_BASE_URL=http://localhost:11434/v1
 * - OLLAMA_MODEL=qwen2.5:7b
 * - OLLAMA_API_KEY=ollama
 *
 * 运行示例：
 *   RUN_OLLAMA_OPENAI_NATIVE_TESTS=1 \
 *   RUN_OLLAMA_OPENAI_TOOL_TESTS=1 \
 *   RUN_OLLAMA_OPENAI_COMPRESSION_TESTS=1 \
 *   OLLAMA_BASE_URL=http://localhost:11434/v1 \
 *   OLLAMA_MODEL=qwen2.5:7b \
 *   pnpm exec vitest run src/main/agent/runtime/openai/__tests__/OpenAIAgents.ollama.native.integration.test.ts
 */

import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Agent, MemorySession, run, setDefaultOpenAIClient, setOpenAIAPI, tool } from '@openai/agents';
import type { AgentInputItem } from '@openai/agents';
import OpenAI from 'openai';
import { z } from 'zod';

import { FileSession } from '../FileSession';
import { SessionCompressor } from '../SessionCompressor';

const RUN = process.env.RUN_OLLAMA_OPENAI_NATIVE_TESTS === '1';
const RUN_TOOL_TESTS = process.env.RUN_OLLAMA_OPENAI_TOOL_TESTS === '1';
const RUN_COMPRESSION_TESTS = process.env.RUN_OLLAMA_OPENAI_COMPRESSION_TESTS === '1';

const describeIf = RUN ? describe : describe.skip;
const itToolIf = RUN_TOOL_TESTS ? it : it.skip;
const itCompressionIf = RUN_COMPRESSION_TESTS ? it : it.skip;

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || 'ollama';

const tempDirs = new Set<string>();

function configureOpenAIAgentsForOllama(): void {
  const client = new OpenAI({
    apiKey: OLLAMA_API_KEY,
    baseURL: OLLAMA_BASE_URL
  });
  // @openai/agents 当前依赖树里带着自己的 openai 版本，这里沿用仓库现有测试的写法做显式放宽。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setDefaultOpenAIClient(client as any);
  setOpenAIAPI('chat_completions');
}

function makeTempSessionDir(name: string): string {
  const dir = path.join(process.cwd(), 'test-results', 'ollama-openai-native', `${Date.now()}-${name}`);
  tempDirs.add(dir);
  return dir;
}

function makeLongText(seed: string, repeat = 24): string {
  return Array.from({ length: repeat }, (_, i) => `${seed} 段落 ${i + 1}。`).join(' ');
}

beforeAll(() => {
  configureOpenAIAgentsForOllama();
});

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs.clear();
});

describeIf('@openai/agents ollama native usage', () => {
  it('basic: 能通过 Ollama 的 OpenAI 兼容接口完成最小对话', async () => {
    const agent = new Agent({
      name: 'Ollama Basic Agent',
      instructions: '你是一个简洁的测试助手，请用一句中文回复。',
      model: OLLAMA_MODEL
    });

    const result = await run(agent, '请只回复“已连接”。');

    expect(String(result.finalOutput || '')).not.toHaveLength(0);
  });

  itToolIf('tool: 能完成单工具调用', async () => {
    const calls: Array<{ city: string }> = [];

    const getWeatherTool = tool({
      name: 'get_weather',
      description: '获取指定城市天气',
      parameters: z.object({ city: z.string() }),
      async execute({ city }) {
        calls.push({ city });
        return `天气：${city} 晴朗，26 度。`;
      }
    });

    const agent = new Agent({
      name: 'Ollama Tool Agent',
      instructions: '当用户询问天气时，必须调用 get_weather 工具。',
      model: OLLAMA_MODEL,
      tools: [getWeatherTool]
    });

    const result = await run(agent, '请调用工具查询上海天气，然后告诉我结果。');

    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]?.city).toBeTruthy();
    expect(String(result.finalOutput || '')).not.toHaveLength(0);
  });

  itToolIf('multi-tools: 能在一轮任务中完成多工具调用', async () => {
    const invoked: string[] = [];

    const addNumbersTool = tool({
      name: 'add_numbers',
      description: '计算两个数字相加结果',
      parameters: z.object({ a: z.number(), b: z.number() }),
      async execute({ a, b }) {
        invoked.push('add_numbers');
        return JSON.stringify({ result: a + b, expression: `${a} + ${b} = ${a + b}` });
      }
    });

    const multiplyNumbersTool = tool({
      name: 'multiply_numbers',
      description: '计算两个数字相乘结果',
      parameters: z.object({ a: z.number(), b: z.number() }),
      async execute({ a, b }) {
        invoked.push('multiply_numbers');
        return JSON.stringify({ result: a * b, expression: `${a} * ${b} = ${a * b}` });
      }
    });

    const agent = new Agent({
      name: 'Ollama Multi Tool Agent',
      instructions: '当用户要求分别做加法和乘法时，必须先调用 add_numbers，再调用 multiply_numbers，最后再总结结果。',
      model: OLLAMA_MODEL,
      tools: [addNumbersTool, multiplyNumbersTool]
    });

    const result = await run(agent, '请先计算 7 + 5，再计算 3 * 4。两个工具都要调用，最后把两个结果一起告诉我。');

    expect(invoked).toContain('add_numbers');
    expect(invoked).toContain('multiply_numbers');
    expect(String(result.finalOutput || '')).not.toHaveLength(0);
  });

  it('session: MemorySession 能基于历史继续对话', async () => {
    const session = new MemorySession();
    const agent = new Agent({
      name: 'Ollama Session Agent',
      instructions: '请基于已有上下文继续回答，回答保持简洁。',
      model: OLLAMA_MODEL
    });

    const first = await run(agent, '金门大桥在哪个城市？', { session });
    const second = await run(agent, '它在哪个州？', { session });

    expect(String(first.finalOutput || '')).not.toHaveLength(0);
    expect(String(second.finalOutput || '')).not.toHaveLength(0);
    expect((await session.getItems()).length).toBeGreaterThan(0);
  });

  itCompressionIf('compression: FileSession + SessionCompressor 能对历史会话生成总结', async () => {
    const sessionDir = makeTempSessionDir('compression');
    await mkdir(sessionDir, { recursive: true });

    const session = new FileSession('ollama-openai-native-compression', sessionDir);
    const compressor = new SessionCompressor({
      enabled: true,
      contextWindowSize: 800,
      thresholdRatio: 0.15,
      keepRatio: 0.3,
      minMessageCount: 4,
      summaryModel: OLLAMA_MODEL
    });

    const history: AgentInputItem[] = [
      {
        role: 'user',
        content: makeLongText('用户介绍自己的项目背景')
      } as unknown as AgentInputItem,
      {
        role: 'assistant',
        content: makeLongText('助手总结项目背景和关键目标')
      } as unknown as AgentInputItem,
      {
        role: 'user',
        content: makeLongText('用户补充技术栈和部署信息')
      } as unknown as AgentInputItem,
      {
        role: 'assistant',
        content: makeLongText('助手记录技术栈和部署信息')
      } as unknown as AgentInputItem,
      {
        role: 'user',
        content: makeLongText('用户描述当前遇到的错误和排查过程')
      } as unknown as AgentInputItem,
      {
        role: 'assistant',
        content: makeLongText('助手归纳错误现象和排查结论')
      } as unknown as AgentInputItem
    ];

    await session.addItems(history);

    const result = await compressor.compressIfNeeded(session, OLLAMA_MODEL);
    const summary = await session.getLastSummary();
    const contextItems = await session.getItems();

    expect(result.compressed).toBe(true);
    expect(summary?.summaryText).toBeTruthy();
    expect(contextItems.length).toBeGreaterThan(0);
  });
});
