import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentDefinition } from '../agents/types';
import type { AgentContext, AgentContextResolver } from '../context/AgentContextResolver';
import { ThreadRunLauncher } from '../ThreadRunLauncher';
import type { ThreadDefinition } from '../threads/types';
import type { ExecutionResult, StreamChunk } from '../runtime/types';
import type { RuntimeBuilder } from '../runtime/RuntimeBuilderFactory';

vi.mock('@main/common/logger', () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  },
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

const mockExecutor = {
  submit: vi.fn(),
  stream: vi.fn()
};

const mockContextResolver = {
  resolve: vi.fn()
};

const mockBuilderFactory = {
  create: vi.fn()
};

const mockThreads = new Map<string, ThreadDefinition>();
const mockAgents = new Map<string, AgentDefinition>();

vi.mock('../threads/ThreadStore', () => ({
  ThreadStore: {
    getInstance: vi.fn().mockResolvedValue({
      get: vi.fn(async (id: string) => mockThreads.get(id))
    })
  }
}));

vi.mock('../agents/AgentStore', () => ({
  AgentStore: {
    getInstance: vi.fn().mockResolvedValue({
      get: vi.fn(async (id: string) => mockAgents.get(id))
    })
  }
}));

describe('ThreadRunLauncher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ThreadRunLauncher.resetInstance();
    mockThreads.clear();
    mockAgents.clear();
    mockExecutor.submit.mockReturnValue({ status: 'accepted', sessionId: 'thread-1' });
    mockBuilderFactory.create.mockReturnValue({ kind: 'mock-builder' } as unknown as RuntimeBuilder);
  });

  it('start 应该通过 runtime factory 组装 builder 并提交执行', async () => {
    const launcher = new ThreadRunLauncher(
      mockExecutor as never,
      mockContextResolver as unknown as AgentContextResolver,
      mockBuilderFactory
    );

    const agent: AgentDefinition = {
      id: 'agent-1',
      name: 'Test Agent',
      description: 'desc',
      instructions: 'You are a test agent',
      model: 'openai/gpt-4',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: 'user',
      version: 1
    };
    const thread: ThreadDefinition = {
      id: 'thread-1',
      title: 'Test Thread',
      agentId: 'agent-1',
      status: 'active',
      sessionId: 'thread-1',
      agentMode: 'agent',
      runStatus: 'idle',
      agentHomePath: '/mock/homes/agent-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const context: AgentContext = {
      agentId: 'agent-1',
      agentName: 'Test Agent',
      agentHomePath: '/mock/homes/agent-1',
      dataDirectory: '/mock/data/agent-1',
      workspacePath: undefined,
      effectiveModel: 'openai/gpt-4',
      sessionDir: '/mock/data/agent-1/sessions/thread-1',
      sessionId: 'thread-1'
    };

    mockAgents.set(agent.id, agent);
    mockThreads.set(thread.id, thread);
    mockContextResolver.resolve.mockResolvedValue(context);

    const result = await launcher.start({
      threadId: 'thread-1',
      message: 'hello'
    });

    expect(mockContextResolver.resolve).toHaveBeenCalledWith({
      agentId: 'agent-1',
      sessionId: 'thread-1',
      threadId: 'thread-1',
      workspace: undefined,
      modelOverride: undefined
    });
    expect(mockBuilderFactory.create).toHaveBeenCalledWith({
      mode: 'agent',
      persistence: 'thread',
      sessionId: 'thread-1',
      agentId: 'agent-1',
      name: 'agent-1',
      instructions: 'You are a test agent',
      modelOverride: 'openai/gpt-4',
    });
    const submitRequest = mockExecutor.submit.mock.calls[0]?.[0];
    expect(submitRequest.sessionId).toBe('thread-1');
    expect(submitRequest.message).toBe('hello');
    expect(submitRequest.builder).toEqual({ kind: 'mock-builder' });
    expect(result).toEqual({ status: 'accepted', sessionId: 'thread-1' });
  });

  it('stream 应该透传统一组装后的执行请求', async () => {
    const launcher = new ThreadRunLauncher(
      mockExecutor as never,
      mockContextResolver as unknown as AgentContextResolver,
      mockBuilderFactory
    );

    const agent: AgentDefinition = {
      id: 'agent-1',
      name: 'Test Agent',
      description: 'desc',
      instructions: '',
      model: 'openai/gpt-4',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: 'user',
      version: 1
    };
    const thread: ThreadDefinition = {
      id: 'thread-1',
      title: 'Test Thread',
      agentId: 'agent-1',
      status: 'active',
      sessionId: 'thread-1',
      agentMode: 'agent',
      runStatus: 'idle',
      agentHomePath: '/mock/homes/agent-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      overrideModel: 'custom/model'
    };
    const context: AgentContext = {
      agentId: 'agent-1',
      agentName: 'Test Agent',
      agentHomePath: '/mock/homes/agent-1',
      dataDirectory: '/mock/data/agent-1',
      workspacePath: '/mock/workspace',
      effectiveModel: 'custom/model',
      sessionDir: '/mock/data/agent-1/sessions/thread-1',
      sessionId: 'thread-1'
    };

    mockAgents.set(agent.id, agent);
    mockThreads.set(thread.id, thread);
    mockContextResolver.resolve.mockResolvedValue(context);

    const chunks: StreamChunk[] = [{ type: 'run:start', content: '' }];
    const finalResult: ExecutionResult = { output: 'done' };

    mockExecutor.stream.mockImplementation(async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
      return finalResult;
    });

    const gen = launcher.stream({
      threadId: 'thread-1',
      message: 'stream message'
    });

    const outputs: StreamChunk[] = [];
    let next = await gen.next();
    while (!next.done) {
      outputs.push(next.value);
      next = await gen.next();
    }

    expect(mockContextResolver.resolve).toHaveBeenCalledWith({
      agentId: 'agent-1',
      sessionId: 'thread-1',
      threadId: 'thread-1',
      workspace: undefined,
      modelOverride: 'custom/model'
    });
    expect(mockBuilderFactory.create).toHaveBeenCalledWith({
      mode: 'agent',
      persistence: 'thread',
      sessionId: 'thread-1',
      agentId: 'agent-1',
      name: 'agent-1',
      instructions: '',
      modelOverride: 'custom/model'
    });
    const streamRequest = mockExecutor.stream.mock.calls[0]?.[0];
    expect(streamRequest.sessionId).toBe('thread-1');
    expect(streamRequest.message).toBe('stream message');
    expect(streamRequest.builder).toEqual({ kind: 'mock-builder' });
    expect(outputs).toEqual(chunks);
    expect(next.value).toEqual(finalResult);
  });

  it('Thread 不存在时应该抛错', async () => {
    const launcher = new ThreadRunLauncher(
      mockExecutor as never,
      mockContextResolver as unknown as AgentContextResolver,
      mockBuilderFactory
    );

    await expect(
      launcher.start({
        threadId: 'missing-thread',
        message: 'hello'
      })
    ).rejects.toThrow('Thread not found');
  });

  it('Agent 不存在时应该抛错', async () => {
    const launcher = new ThreadRunLauncher(
      mockExecutor as never,
      mockContextResolver as unknown as AgentContextResolver,
      mockBuilderFactory
    );

    mockThreads.set('thread-1', {
      id: 'thread-1',
      title: 'Test Thread',
      agentId: 'missing-agent',
      status: 'active',
      sessionId: 'thread-1',
      agentMode: 'agent',
      runStatus: 'idle',
      agentHomePath: '/mock/homes/missing-agent',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    await expect(
      launcher.start({
        threadId: 'thread-1',
        message: 'hello'
      })
    ).rejects.toThrow('Agent not found');
  });
});
