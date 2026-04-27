/**
 * Ollama 最简测试 — 从零开始，一步一步加
 *
 * 运行命令：
 *   pnpm vitest run src/main/agent/runtime/pimono/__tests__/PiMonoAgentRuntime.ollama.test.ts
 */

import path from 'path';
import fs from 'fs';
import { describe, it, expect, vi } from 'vitest';

// ===== Electron 环境 stub（必须，PiMonoAgentRuntime 依赖 electron） =====

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

import { PiMonoAgentRuntime } from '../PiMonoAgentRuntime';

// ===== Ollama 配置 =====

const OLLAMA_CONFIG = {
  baseURL: process.env.VITE_OLLAMA_BASE_URL || 'http://localhost:11434/v1',
  model: process.env.VITE_OLLAMA_MODEL || 'gemma4:e4b'
};

// ===== 测试 =====

describe('Ollama 最简测试', () => {
  it('步骤1：发送一句话，得到回复', { timeout: 60_000 }, async () => {
    const runtime = new PiMonoAgentRuntime({
      type: 'pi-mono',
      name: 'OllamaTest',
      instructions: '你是一个简洁的助手。',
      provider: 'ollama',
      apiType: 'openai-compatible',
      apiKey: 'ollama',
      baseURL: OLLAMA_CONFIG.baseURL,
      model: OLLAMA_CONFIG.model,
      sessionDir: '/tmp/ollama-test',
      sessionMode: 'memory',
      thinkingLevel: 'low',
      compaction: { enabled: false },
      modelMeta: { reasoning: false }
    });

    const result = await runtime.run('用一句话介绍你自己');

    console.log('输出:', result.output);
    console.log('耗时:', result.duration, 'ms');

    // 最基本验证：有输出就行
    expect(result.output.length).toBeGreaterThan(0);
    expect(result.duration).toBeGreaterThan(0);
  });

  it('步骤2：流式输出（逐 chunk 接收）', { timeout: 60_000 }, async () => {
    const runtime = new PiMonoAgentRuntime({
      type: 'pi-mono',
      name: 'OllamaStreamTest',
      instructions: '你是一个简洁的助手。',
      provider: 'ollama',
      apiType: 'openai-compatible',
      apiKey: 'ollama',
      baseURL: OLLAMA_CONFIG.baseURL,
      model: OLLAMA_CONFIG.model,
      sessionDir: '/tmp/ollama-test',
      sessionMode: 'memory',
      thinkingLevel: 'minimal',
      compaction: { enabled: false },
      modelMeta: { reasoning: true }
    });

    // 用 stream() 逐个收 chunk，模拟 SSE 场景
    const streamLogFile = path.join(process.cwd(), 'test-results', `ollama-stream-${Date.now()}.jsonl`);
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

    console.log('流输出文件:', streamLogFile);
    console.log('总 delta 数:', deltaCount);
    console.log('拼接内容:', chunks.join(''));
    console.log('最终输出:', result.output);

    // 验证流式输出有内容且事件闭环完整
    expect(deltaCount).toBeGreaterThan(0);
    expect(result.output.length).toBeGreaterThan(0);
    expect(result.duration).toBeGreaterThan(0);
  });
});
