/**
 * OpenAIAgentRuntime Ollama 最简测试 — 从零开始，一步一步加
 *
 * 运行命令：
 *   pnpm vitest run src/main/agent/runtime/openai/__tests__/OpenAIAgentRuntime.ollama.test.ts
 */

import path from 'path';
import fs from 'fs';
import { describe, it, expect, vi } from 'vitest';

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

vi.mock('electron-log', () => {
  const noop = (): void => {};
  const transports = {
    file: { level: 'info', getFile: () => ({ path: '/tmp/test.log' }) },
    console: { level: 'info' }
  };
  const logger = { info: noop, warn: noop, error: noop, debug: noop, verbose: noop, transports };
  return {
    default: Object.assign(logger, {
      create: () => ({ ...logger, transports: { ...transports } })
    })
  };
});

vi.mock('mkdirp', () => ({ mkdirp: vi.fn().mockResolvedValue(undefined) }));

// ===== 真实 import =====

import { OpenAIAgentRuntime } from '../OpenAIAgentRuntime';

// ===== Ollama 配置 =====

const OLLAMA_CONFIG = {
  baseURL: process.env.VITE_OLLAMA_BASE_URL || 'http://localhost:11434/v1',
  model: process.env.VITE_OLLAMA_MODEL || 'gemma4:e4b'
};

// ===== 测试 =====

describe('Ollama 最简测试', () => {
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
      thinkingLevel: 'minimal',
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
        if (
          chunk.type === 'reasoning:delta' ||
          chunk.content.includes('<think>') ||
          chunk.content.includes('</think>')
        ) {
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
});
