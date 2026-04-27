/**
 * OpenAIAgentRuntime Ollama 最简测试 — 从零开始，一步一步加
 *
 * 运行命令：
 *   pnpm vitest run src/main/agent/runtime/openai/__tests__/OpenAIAgentRuntime.ollama.test.ts
 */

import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { describe, it, expect, afterEach, vi } from 'vitest';

// ===== Electron 环境 stub（必须，OpenAIAgentRuntime 依赖 electron） =====

vi.mock('electron', () => {
  const base = path.join(process.cwd(), 'test-results');
  return {
    app: {
      getPath: () => base,
      getAppPath: () => base,
      getName: () => 'test',
      getVersion: () => '0.0.0',
      getLocale: () => 'zh-CN',
      isPackaged: false
    },
    BrowserWindow: vi.fn(),
    ipcMain: { on: vi.fn(), handle: vi.fn() },
    session: { defaultSession: { webRequest: { onHeadersReceived: vi.fn() } } }
  };
});

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }));

// 日志缓冲区：mock 会在静态 import 前执行，必须用 vi.hoisted 避免 TDZ。
const { logBuffer, logPath } = vi.hoisted(() => ({
  logBuffer: [] as string[],
  logPath: `${process.cwd()}/test-results/logs/openai-ollama-test.log`
}));

function flushLogBuffer(): void {
  if (logBuffer.length > 0) {
    const logDir = path.dirname(logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    fs.appendFileSync(logPath, logBuffer.join(''), 'utf-8');
    logBuffer.length = 0;
  }
}

// RuntimeLogger fallbacks to console.debug in test env.
// Intercept console.debug to capture runtime logs to file.
const originalConsoleDebug = console.debug;
console.debug = (...args: unknown[]) => {
  const message = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  logBuffer.push(`[${new Date().toISOString()}] [DEBUG] ${message}\n`);
  originalConsoleDebug(...args);
};
vi.mock('electron-log', () => {
  const addToBuffer = (level: string, ...args: unknown[]): void => {
    const timestamp = new Date().toISOString();
    const message = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    logBuffer.push(`[${timestamp}] [${level}] ${message}\n`);
  };

  const transports = {
    file: { level: 'debug', getFile: () => ({ path: logPath }) },
    console: { level: 'info' }
  };

  const logger = {
    info: (...args: unknown[]) => addToBuffer('INFO', ...args),
    warn: (...args: unknown[]) => addToBuffer('WARN', ...args),
    error: (...args: unknown[]) => addToBuffer('ERROR', ...args),
    debug: (...args: unknown[]) => addToBuffer('DEBUG', ...args),
    verbose: (...args: unknown[]) => addToBuffer('VERBOSE', ...args),
    transports
  };

  return {
    default: Object.assign(logger, {
      create: () => ({ ...logger, transports: { ...transports } })
    })
  };
});

vi.mock('mkdirp', () => ({ mkdirp: vi.fn().mockResolvedValue(undefined) }));

// ===== 真实 import =====

import { OpenAIAgentRuntime } from '../OpenAIAgentRuntime';
import type { ToolDefinition } from '../../../tools/types';
import { ToolCategory } from '../../../tools/types';

// ===== Ollama 配置 =====

const OLLAMA_CONFIG = {
  baseURL: process.env.VITE_OLLAMA_BASE_URL || 'http://localhost:11434/v1',
  model: process.env.VITE_OLLAMA_MODEL || 'gemma4:e4b'
};

// ===== 测试 =====

// 确保日志目录存在
const logDir = path.join(process.cwd(), 'test-results', 'logs');
fs.mkdirSync(logDir, { recursive: true });

// 测试日志写入是否工作（删除旧的测试文件）
const testLogFile = path.join(logDir, 'test-write.log');
fs.writeFileSync(testLogFile, `[${new Date().toISOString()}] [TEST] 日志系统初始化成功\n`, 'utf-8');

describe('Ollama 最简测试', () => {
  // 每个测试完成后刷日志到文件
  afterEach(() => {
    flushLogBuffer();
  });

  it('步骤1：发送一句话，得到回复', { timeout: 60_000 }, async () => {
    const sessionId = `ollama-test-${Date.now()}`;
    const runtime = new OpenAIAgentRuntime({
      type: 'openai',
      name: 'OllamaTest',
      instructions: '你是一个简洁的助手。',
      provider: 'ollama',
      apiType: 'openai-compatible',
      apiKey: 'ollama',
      baseURL: OLLAMA_CONFIG.baseURL,
      model: OLLAMA_CONFIG.model,
      sessionId,
      sessionDir: `/tmp/ollama-test-${Date.now()}`,
      sessionMode: 'memory',
      thinkingLevel: 'minimal',
      modelMeta: { reasoning: false },
      compaction: { enabled: false }
    });

    // 用 stream() 接收数据并写入文件
    const streamLogFile = path.join(process.cwd(), 'test-results', `ollama-step1-${Date.now()}.jsonl`);
    fs.mkdirSync(path.dirname(streamLogFile), { recursive: true });
    fs.writeFileSync(streamLogFile, '', 'utf-8');

    const chunks: string[] = [];
    let deltaCount = 0;
    const gen = runtime.stream('用一句话介绍你自己');
    let r = await gen.next();
    while (!r.done) {
      const chunk = r.value;
      deltaCount++;
      chunks.push(chunk.content);
      // 将整个 chunk 对象 JSON 序列化写入文件，方便研究原始结构
      fs.appendFileSync(streamLogFile, JSON.stringify(chunk, null, 2) + '\n\n', 'utf-8');
      r = await gen.next();
    }
    const result = r.value;

    console.log('步骤1输出文件:', streamLogFile);
    console.log('总 delta 数:', deltaCount);
    console.log('输出:', result.output);
    console.log('耗时:', result.duration, 'ms');

    // 最基本验证：有输出就行
    expect(result.output.length).toBeGreaterThan(0);
    expect(result.duration).toBeGreaterThan(0);
  });

  it('步骤2：流式输出（逐 chunk 接收）', { timeout: 60_000 }, async () => {
    const sessionId = `ollama-stream-test-${Date.now()}`;
    const runtime = new OpenAIAgentRuntime({
      type: 'openai',
      name: 'OllamaStreamTest',
      instructions: '你是一个简洁的助手。',
      provider: 'ollama',
      apiType: 'openai-compatible',
      apiKey: 'ollama',
      baseURL: OLLAMA_CONFIG.baseURL,
      model: OLLAMA_CONFIG.model,
      sessionId,
      sessionDir: '/tmp/openai-ollama-test',
      sessionMode: 'memory',
      thinkingLevel: 'off',
      modelMeta: { reasoning: true },
      compaction: { enabled: true }
    });

    // 用 stream() 逐个收 chunk，模拟 SSE 场景
    const streamLogFile = path.join(process.cwd(), 'test-results', `ollama-step2-stream-${Date.now()}.jsonl`);
    fs.mkdirSync(path.dirname(streamLogFile), { recursive: true });
    fs.writeFileSync(streamLogFile, '', 'utf-8');

    const chunks: string[] = [];
    let deltaCount = 0;
    const gen = runtime.stream('请列举 3 个水果的名字，用顿号分隔');
    let r = await gen.next();
    while (!r.done) {
      const chunk = r.value;
      deltaCount++;
      chunks.push(chunk.content);
      // 将整个 chunk 对象 JSON 序列化写入文件，方便研究原始结构
      fs.appendFileSync(streamLogFile, JSON.stringify(chunk, null, 2) + '\n\n', 'utf-8');
      r = await gen.next();
    }
    const result = r.value;

    console.log('步骤2输出文件:', streamLogFile);
    console.log('总 delta 数:', deltaCount);
    console.log('拼接内容:', chunks.join(''));
    console.log('最终输出:', result.output);

    // 验证流式输出有内容且事件闭环完整
    expect(deltaCount).toBeGreaterThan(0);
    expect(result.output.length).toBeGreaterThan(0);
    expect(result.duration).toBeGreaterThan(0);
  });

  it('步骤3：开启思维链（reasoning: true + 高级别思考）', { timeout: 60_000 }, async () => {
    const sessionId = `ollama-reasoning-test-${Date.now()}`;
    const runtime = new OpenAIAgentRuntime({
      type: 'openai',
      name: 'OllamaReasoningTest',
      instructions: '你是一个善于深入思考的助手，遇到复杂问题会先进行推理分析。',
      provider: 'ollama',
      apiType: 'openai-compatible',
      apiKey: 'ollama',
      baseURL: OLLAMA_CONFIG.baseURL,
      model: OLLAMA_CONFIG.model,
      sessionId,
      sessionDir: `/tmp/openai-ollama-reasoning-${Date.now()}`,
      sessionMode: 'memory',
      thinkingLevel: 'high',
      modelMeta: { reasoning: true },
      compaction: { enabled: false }
    });

    // 用一个需要思考的复杂问题来测试
    const streamLogFile = path.join(process.cwd(), 'test-results', `ollama-step3-reasoning-${Date.now()}.jsonl`);
    fs.mkdirSync(path.dirname(streamLogFile), { recursive: true });
    fs.writeFileSync(streamLogFile, '', 'utf-8');

    const gen = runtime.stream('请分析一下为什么大多数编程教程都从 Hello World 开始？这个传统有什么深层原因？');

    const chunks: string[] = [];
    const thinkContent: string[] = [];
    let deltaCount = 0;
    let thinkDeltaCount = 0;

    let r = await gen.next();
    while (!r.done) {
      const chunk = r.value;
      deltaCount++;

      // 记录所有内容（包括思考过程）
      if (chunk.content) {
        chunks.push(chunk.content);
        // 检查是否包含思考标签或推理内容
        if (chunk.type === 'reasoning:delta') {
          thinkDeltaCount++;
          thinkContent.push(chunk.content);
        }
      }

      // 将整个 chunk 对象 JSON 序列化写入文件，方便研究原始结构
      fs.appendFileSync(streamLogFile, JSON.stringify(chunk, null, 2) + '\n\n', 'utf-8');

      r = await gen.next();
    }
    const result = r.value;

    const fullThinkContent = thinkContent.join('');

    console.log('步骤3输出文件:', streamLogFile);
    console.log('=== 思维链测试 ===');
    console.log('总 delta 数:', deltaCount);
    console.log('推理 delta 数:', thinkDeltaCount);
    console.log('推理内容长度:', fullThinkContent.length);
    if (fullThinkContent.length > 0) {
      console.log('推理内容预览:', fullThinkContent.slice(0, 200));
    }
    console.log('最终输出:', result.output);
    console.log('最终输出长度:', result.output.length);
    console.log('耗时:', result.duration, 'ms');

    // 验证有输出和推理过程（如果模型支持）
    expect(deltaCount).toBeGreaterThan(0);
    expect(result.output.length).toBeGreaterThan(0);
    expect(result.duration).toBeGreaterThan(0);

    // 注意：gemma4:e4b 可能不支持推理标签，所以这里只记录，不强制要求
    if (thinkDeltaCount > 0) {
      console.log('✅ 检测到推理过程输出');
      expect(thinkDeltaCount).toBeGreaterThan(0);
    } else {
      console.log('ℹ️  模型未输出推理过程（可能不支持 reasoning 标签）');
    }
  });

  it('步骤4：关闭思维链（reasoning: true + thinkingLevel=off）', { timeout: 60_000 }, async () => {
    const sessionId = `ollama-no-reasoning-test-${Date.now()}`;
    const runtime = new OpenAIAgentRuntime({
      type: 'openai',
      name: 'OllamaNoReasoningTest',
      instructions: '你是一个善于深入思考的助手，遇到复杂问题会先进行推理分析。',
      provider: 'ollama',
      apiType: 'openai-compatible',
      apiKey: 'ollama',
      baseURL: OLLAMA_CONFIG.baseURL,
      model: OLLAMA_CONFIG.model,
      sessionId,
      sessionDir: `/tmp/openai-ollama-no-reasoning-${Date.now()}`,
      sessionMode: 'memory',
      thinkingLevel: 'off',
      modelMeta: { reasoning: true },
      compaction: { enabled: false }
    });

    // 用同样需要思考的复杂问题来测试关闭效果
    const streamLogFile = path.join(process.cwd(), 'test-results', `ollama-step4-no-reasoning-${Date.now()}.jsonl`);
    fs.mkdirSync(path.dirname(streamLogFile), { recursive: true });
    fs.writeFileSync(streamLogFile, '', 'utf-8');

    const gen = runtime.stream('请分析一下为什么大多数编程教程都从 Hello World 开始？这个传统有什么深层原因？');

    const chunks: string[] = [];
    const thinkContent: string[] = [];
    let deltaCount = 0;
    let thinkDeltaCount = 0;

    let r = await gen.next();
    while (!r.done) {
      const chunk = r.value;
      deltaCount++;

      if (chunk.content) {
        chunks.push(chunk.content);
        if (chunk.type === 'reasoning:delta') {
          thinkDeltaCount++;
          thinkContent.push(chunk.content);
        }
      }

      fs.appendFileSync(streamLogFile, JSON.stringify(chunk, null, 2) + '\n\n', 'utf-8');

      r = await gen.next();
    }
    const result = r.value;

    const fullThinkContent = thinkContent.join('');

    console.log('步骤4输出文件:', streamLogFile);
    console.log('=== 关闭思维链测试 ===');
    console.log('总 delta 数:', deltaCount);
    console.log('推理 delta 数:', thinkDeltaCount);
    console.log('推理内容长度:', fullThinkContent.length);
    if (fullThinkContent.length > 0) {
      console.log('推理内容预览:', fullThinkContent.slice(0, 200));
    }
    console.log('最终输出:', result.output);
    console.log('最终输出长度:', result.output.length);
    console.log('耗时:', result.duration, 'ms');

    expect(deltaCount).toBeGreaterThan(0);
    expect(result.output.length).toBeGreaterThan(0);
    expect(result.duration).toBeGreaterThan(0);

    if (thinkDeltaCount === 0) {
      console.log('✅ thinkingLevel=off 成功关闭推理过程');
    } else {
      console.log('⚠️  模型仍然输出了推理过程（thinkingLevel=off 未完全生效）');
    }
  });

  it('步骤5：多轮工具调用（两个工具，让 LLM 自行决定调用）', { timeout: 120_000 }, async () => {
    // ===== 定义工具 1：加法计算器 =====
    const calculatorTool: ToolDefinition = {
      name: 'calculator',
      description: '执行简单的加减乘除运算。输入两个数字和运算符 (+, -, *, /)，返回计算结果。',
      category: ToolCategory.Execute,
      parameters: z.object({
        a: z.number().describe('第一个数字'),
        b: z.number().describe('第二个数字'),
        op: z.enum(['+', '-', '*', '/']).describe('运算符：+, -, *, /')
      }),
      execute: async function* (params) {
        const { a, b, op } = params as { a: number; b: number; op: string };
        let result: number;
        switch (op) {
          case '+':
            result = a + b;
            break;
          case '-':
            result = a - b;
            break;
          case '*':
            result = a * b;
            break;
          case '/':
            result = b !== 0 ? a / b : NaN;
            break;
          default:
            result = NaN;
        }
        yield { type: 'progress', content: `正在计算 ${a} ${op} ${b}...` };
        return {
          success: true,
          llmContent: `${a} ${op} ${b} = ${Number.isFinite(result) ? result : '错误（除数为零）'}`
        };
      }
    };

    // ===== 定义工具 2：字符串反转 =====
    const reverseTool: ToolDefinition = {
      name: 'reverse_string',
      description: '将输入的字符串反转后返回。例如 "hello" → "olleh"。',
      category: ToolCategory.Execute,
      parameters: z.object({
        text: z.string().describe('要反转的字符串')
      }),
      execute: async function* (params) {
        const { text } = params as { text: string };
        yield { type: 'progress', content: `正在反转字符串 "${text}"...` };
        const reversed = text.split('').reverse().join('');
        return {
          success: true,
          llmContent: `"${text}" 反转后是 "${reversed}"`
        };
      }
    };

    const sessionId = `ollama-tool-test-${Date.now()}`;
    const runtime = new OpenAIAgentRuntime({
      type: 'openai',
      name: 'OllamaToolTest',
      instructions:
        '你是一个可以调用工具的助手。' +
        '当用户需要计算时，使用 calculator 工具。' +
        '当用户需要反转字符串时，使用 reverse_string 工具。' +
        '你需要根据用户的问题，自行决定调用哪个工具，然后根据工具返回的结果回答用户。',
      provider: 'ollama',
      apiType: 'openai-compatible',
      apiKey: 'ollama',
      baseURL: OLLAMA_CONFIG.baseURL,
      model: OLLAMA_CONFIG.model,
      sessionId,
      sessionDir: `/tmp/openai-ollama-tool-${Date.now()}`,
      sessionMode: 'memory',
      thinkingLevel: 'off',
      modelMeta: { reasoning: false },
      compaction: { enabled: false },
      tools: [calculatorTool, reverseTool],
      maxTurns: 10
    });

    const streamLogFile = path.join(process.cwd(), 'test-results', `ollama-step5-tools-${Date.now()}.jsonl`);
    fs.mkdirSync(path.dirname(streamLogFile), { recursive: true });
    fs.writeFileSync(streamLogFile, '', 'utf-8');

    // 提出一个需要调用两个工具的问题
    const prompt =
      '请帮我做两件事：1) 计算 123 + 456 的结果；2) 把 "coobee" 这个字符串反转。最后把两个结果一起告诉我。';
    console.log('步骤5输入:', prompt);

    const gen = runtime.stream(prompt);

    let deltaCount = 0;

    let r = await gen.next();
    while (!r.done) {
      const chunk = r.value;
      deltaCount++;

      // 工具事件带上 callId，方便并行调用时区分
      const d = chunk.data as { callId?: string } | undefined;
      const callId = d?.callId ? ` [${d.callId}]` : '';
      console.log(`  [${chunk.type}]${callId}`, chunk.content || '');

      // 记录所有 chunk 到文件（单行 JSON）
      fs.appendFileSync(streamLogFile, JSON.stringify(chunk) + '\n', 'utf-8');

      r = await gen.next();
    }
    const result = r.value;

    console.log('步骤5输出文件:', streamLogFile);
    console.log('=== 多轮工具调用测试 ===');
    console.log('总事件数:', deltaCount);
    console.log('最终输出:', result.output);
    console.log('工具调用详情:', JSON.stringify(result.toolCalls, null, 2));
    console.log('耗时:', result.duration, 'ms');

    // 验证
    expect(deltaCount).toBeGreaterThan(0);
    expect(result.output.length).toBeGreaterThan(0);
    expect(result.duration).toBeGreaterThan(0);
  });
});
