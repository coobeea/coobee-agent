/**
 * Chat API 端到端测试
 *
 * 测试完整的 Chat API 流程，包括：
 * 1. 创建会话（Thread）
 * 2. 列出会话
 * 3. 发送消息并接收 SSE 流式响应
 * 4. 验证数据持久化
 *
 * 运行方式：
 *   pnpm test:e2e
 *
 * 前置条件：
 *   - Ollama 本地运行 (http://127.0.0.1:11434)
 *   - qwen3.5:9b 模型已安装
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import path from 'path';

const BASE_URL = 'http://127.0.0.1:8765';
const API_PREFIX = '/gateway/chat';

describe('Chat API E2E', () => {
  let threadId: string;

  beforeAll(() => {
    console.log('\n🚀 开始 Chat API 端到端测试');
    console.log('📍 目标地址:', BASE_URL);
    console.log('🤖 测试模型: qwen3.5:9b\n');
  });

  afterAll(() => {
    console.log('\n✅ Chat API 端到端测试完成\n');
  });

  describe('Thread Management', () => {
    it('should create a new thread', async () => {
      const response = await fetch(`${BASE_URL}${API_PREFIX}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'E2E Test Thread',
          agentId: 'app-copilot',
          overrideModel: 'qwen3.5:9b'
        })
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.id).toBeDefined();
      expect(data.data.title).toBe('E2E Test Thread');
      expect(data.data.agentId).toBe('app-copilot');
      expect(data.data.overrideModel).toBe('qwen3.5:9b');

      threadId = data.data.id;
      console.log(`✅ 创建会话成功: ${threadId}`);
    });

    it('should list all threads', async () => {
      const response = await fetch(`${BASE_URL}${API_PREFIX}/threads`);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.threads).toBeDefined();
      expect(Array.isArray(data.data.threads)).toBe(true);
      expect(data.data.threads.length).toBeGreaterThan(0);

      // 验证刚创建的 thread 在列表中
      const thread = data.data.threads.find((t: any) => t.id === threadId);
      expect(thread).toBeDefined();
      expect(thread.title).toBe('E2E Test Thread');

      console.log(`✅ 列出 ${data.data.threads.length} 个会话`);
    });

    it('should get thread by id', async () => {
      const response = await fetch(`${BASE_URL}${API_PREFIX}/threads/${threadId}`);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.id).toBe(threadId);
      expect(data.data.title).toBe('E2E Test Thread');

      console.log(`✅ 获取会话详情: ${data.data.title}`);
    });
  });

  describe('Message Streaming (SSE)', () => {
    it('should send message and receive SSE stream', async () => {
      return new Promise<void>((resolve, reject) => {
        const testMessage = '请用一句话介绍你自己';
        let receivedChunks: any[] = [];
        let textContent = '';

        console.log(`\n📤 发送消息: "${testMessage}"`);

        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: 8765,
            path: `${API_PREFIX}/threads/${threadId}/messages`,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            }
          },
          (res) => {
            // 验证响应头
            expect(res.statusCode).toBe(200);
            expect(res.headers['content-type']).toBe('text/event-stream');

            console.log('📥 接收 SSE 流...\n');

            res.setEncoding('utf8');
            let buffer = '';

            res.on('data', (chunk) => {
              buffer += chunk;

              // 按行处理
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                  try {
                    const data = JSON.parse(line.substring(6));
                    receivedChunks.push(data);

                    // 收集文本内容
                    if (data.type === 'text:delta' && data.content) {
                      textContent += data.content;
                      process.stdout.write(data.content);
                    }

                    // 打印关键事件
                    if (data.type === 'run:start') {
                      console.log('🏁 开始执行');
                    } else if (data.type === 'run:done') {
                      console.log('\n\n✅ 执行完成');
                      if (data.data?.usage) {
                        console.log(
                          `📊 Token 用量: 输入=${data.data.usage.inputTokens}, 输出=${data.data.usage.outputTokens}`
                        );
                      }
                    }
                  } catch (e) {
                    // 忽略 JSON 解析错误
                  }
                } else if (line.startsWith('event: done')) {
                  console.log('\n🎉 SSE 流结束');
                }
              }
            });

            res.on('end', () => {
              // 验证接收到的数据
              expect(receivedChunks.length).toBeGreaterThan(0);
              expect(textContent.length).toBeGreaterThan(0);

              // 验证关键事件类型
              const eventTypes = receivedChunks.map((c) => c.type);
              expect(eventTypes).toContain('run:start');
              expect(eventTypes).toContain('text:delta');
              expect(eventTypes).toContain('run:done');

              console.log(`\n📈 总共接收 ${receivedChunks.length} 个事件块`);
              console.log(`📝 生成文本长度: ${textContent.length} 字符\n`);

              resolve();
            });

            res.on('error', (err) => {
              console.error('\n❌ SSE 流错误:', err);
              reject(err);
            });
          }
        );

        req.on('error', (err) => {
          console.error('\n❌ 请求错误:', err);
          reject(err);
        });

        req.write(JSON.stringify({ message: testMessage }));
        req.end();
      });
    }, 60000); // 60s 超时

    it('should handle multiple messages in the same thread', async () => {
      return new Promise<void>((resolve, reject) => {
        const testMessage = '你的名字是什么？';
        let textContent = '';

        console.log(`\n📤 发送第二条消息: "${testMessage}"`);

        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: 8765,
            path: `${API_PREFIX}/threads/${threadId}/messages`,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            }
          },
          (res) => {
            expect(res.statusCode).toBe(200);

            console.log('📥 接收 SSE 流...\n');

            res.setEncoding('utf8');
            let buffer = '';

            res.on('data', (chunk) => {
              buffer += chunk;
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                  try {
                    const data = JSON.parse(line.substring(6));
                    if (data.type === 'text:delta' && data.content) {
                      textContent += data.content;
                      process.stdout.write(data.content);
                    }
                  } catch (e) {
                    // ignore
                  }
                }
              }
            });

            res.on('end', () => {
              expect(textContent.length).toBeGreaterThan(0);
              console.log(`\n\n✅ 第二条消息处理完成\n`);
              resolve();
            });

            res.on('error', reject);
          }
        );

        req.on('error', reject);
        req.write(JSON.stringify({ message: testMessage }));
        req.end();
      });
    }, 60000);
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent thread', async () => {
      const response = await fetch(`${BASE_URL}${API_PREFIX}/threads/999999`);

      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();

      console.log('✅ 正确处理不存在的会话');
    });

    it('should return 400 for empty message', async () => {
      return new Promise<void>((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: 8765,
            path: `${API_PREFIX}/threads/${threadId}/messages`,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            }
          },
          (res) => {
            expect(res.statusCode).toBe(400);

            let body = '';
            res.on('data', (chunk) => {
              body += chunk;
            });

            res.on('end', () => {
              const data = JSON.parse(body);
              expect(data.success).toBe(false);
              expect(data.error.message).toBe('message is required');

              console.log('✅ 正确处理空消息');
              resolve();
            });

            res.on('error', reject);
          }
        );

        req.on('error', reject);
        req.write(JSON.stringify({ message: '' }));
        req.end();
      });
    });

    it('should return 404 for message to non-existent thread', async () => {
      return new Promise<void>((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: 8765,
            path: `${API_PREFIX}/threads/999999/messages`,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            }
          },
          (res) => {
            expect(res.statusCode).toBe(404);

            let body = '';
            res.on('data', (chunk) => {
              body += chunk;
            });

            res.on('end', () => {
              const data = JSON.parse(body);
              expect(data.success).toBe(false);
              expect(data.error.message).toBe('Thread not found');

              console.log('✅ 正确处理发送消息到不存在的会话');
              resolve();
            });

            res.on('error', reject);
          }
        );

        req.on('error', reject);
        req.write(JSON.stringify({ message: '你好' }));
        req.end();
      });
    });
  });
});
