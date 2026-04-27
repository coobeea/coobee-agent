/**
 * 原生 openai SDK 测试 Ollama Chat Completions API 的 reasoning 控制
 *
 * 运行方式：pnpm vitest run src/main/agent/runtime/openai/__tests__/OllamaNativeReasoning.test.ts
 */
import { describe, it, expect } from 'vitest';
import OpenAI from 'openai';

/** 扩展 delta 类型以包含 Ollama 返回的 reasoning 字段 */
interface ExtendedDelta extends OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta {
  reasoning?: string;
  reasoning_content?: string;
}

function getReasoning(delta: ExtendedDelta): string | undefined {
  // Ollama Chat Completions API 推理在 delta.reasoning，不在 delta.reasoning_content
  return delta.reasoning || delta.reasoning_content;
}

const BASE_URL = process.env.VITE_OLLAMA_BASE_URL || 'http://localhost:11434/v1';
const MODEL = process.env.VITE_OLLAMA_MODEL || 'gemma4:e4b';

const COMPLEX_QUESTION = '请分析一下为什么大多数编程教程都从 Hello World 开始？这个传统有什么深层原因？';

describe('原生 OpenAI SDK → Ollama Chat Completions 推理控制测试', () => {
  it('步骤A：reasoning 开关启用（effort=high）', { timeout: 120_000 }, async () => {
    const client = new OpenAI({ baseURL: BASE_URL, apiKey: 'ollama' });

    const stream = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: COMPLEX_QUESTION }],
      stream: true,
      reasoning_effort: 'high'
    });

    let hasReasoning = false;
    let content = '';
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta as ExtendedDelta;
      const rc = getReasoning(delta);
      if (rc) {
        hasReasoning = true;
      }
      if (delta?.content) {
        content += delta.content;
      }
    }

    console.log('=== 步骤A：reasoning_effort=high ===');
    console.log('有推理内容:', hasReasoning);
    console.log('输出长度:', content.length);
    console.log('输出预览:', content.slice(0, 200));

    expect(content.length).toBeGreaterThan(0);
  });

  it('步骤B：reasoning 关闭（effort=none）', { timeout: 120_000 }, async () => {
    const client = new OpenAI({ baseURL: BASE_URL, apiKey: 'ollama' });

    const stream = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: COMPLEX_QUESTION }],
      stream: true,
      reasoning_effort: 'none'
    });

    let hasReasoning = false;
    let content = '';
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta as ExtendedDelta;
      const rc = getReasoning(delta);
      if (rc) {
        hasReasoning = true;
      }
      if (delta?.content) {
        content += delta.content;
      }
    }

    console.log('=== 步骤B：reasoning_effort=none ===');
    console.log('有推理内容:', hasReasoning);
    console.log('输出长度:', content.length);
    console.log('输出预览:', content.slice(0, 200));

    expect(content.length).toBeGreaterThan(0);
    console.log(hasReasoning ? '❌ reasoning_effort=none 未生效' : '✅ reasoning_effort=none 生效，无推理内容');
  });
});
