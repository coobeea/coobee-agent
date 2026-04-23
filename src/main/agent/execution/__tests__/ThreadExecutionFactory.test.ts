/**
 * ThreadExecutionFactory 单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ThreadExecutionFactory, type CreateBuilderParams } from '../ThreadExecutionFactory';
import type { AgentDefinition } from '../../agents/types';
import type { ThreadDefinition } from '../../threads/types';
import type { AgentContext, AgentContextResolver } from '../../context/AgentContextResolver';
import type { getAgentExecutor } from '../../AgentExecutor';

type AgentExecutorInstance = ReturnType<typeof getAgentExecutor>;

// Mock dependencies
vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

// Mock AgentExecutor
const mockBuilder = {
  sessionMode: vi.fn().mockReturnThis(),
  agentId: vi.fn().mockReturnThis(),
  name: vi.fn().mockReturnThis(),
  instructions: vi.fn().mockReturnThis()
};

const mockAgentExecutor = {
  piMono: vi.fn().mockReturnValue(mockBuilder),
  applyProviderConfig: vi.fn()
};

// Mock ContextResolver
const mockContextResolver = {
  resolve: vi.fn()
};

// Mock stores
const mockThreads = new Map<string, ThreadDefinition>();
const mockAgents = new Map<string, AgentDefinition>();

vi.mock('@main/agent/threads/ThreadStore', () => ({
  ThreadStore: {
    getInstance: vi.fn().mockReturnValue({
      get: vi.fn(async (id: string) => mockThreads.get(id))
    })
  }
}));

vi.mock('@main/agent/agents/AgentStore', () => ({
  AgentStore: {
    getInstance: vi.fn().mockReturnValue({
      get: vi.fn(async (id: string) => mockAgents.get(id))
    })
  }
}));

describe('ThreadExecutionFactory', () => {
  let factory: ThreadExecutionFactory;

  beforeEach(() => {
    // 重置单例和 mocks
    ThreadExecutionFactory.resetInstance();
    mockThreads.clear();
    mockAgents.clear();
    vi.clearAllMocks();

    // 创建 factory
    factory = ThreadExecutionFactory.getInstance(
      mockAgentExecutor as unknown as AgentExecutorInstance,
      mockContextResolver as unknown as AgentContextResolver
    );
  });

  describe('单例模式', () => {
    it('应该返回同一个实例', () => {
      const instance1 = ThreadExecutionFactory.getInstance(mockAgentExecutor as unknown as AgentExecutorInstance);
      const instance2 = ThreadExecutionFactory.getInstance(mockAgentExecutor as unknown as AgentExecutorInstance);

      expect(instance1).toBe(instance2);
    });

    it('resetInstance 应该清空单例', () => {
      const instance1 = ThreadExecutionFactory.getInstance(mockAgentExecutor as unknown as AgentExecutorInstance);
      ThreadExecutionFactory.resetInstance();
      const instance2 = ThreadExecutionFactory.getInstance(mockAgentExecutor as unknown as AgentExecutorInstance);

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('Thread 不存在', () => {
    it('应该抛出错误', async () => {
      const params: CreateBuilderParams = {
        threadId: 'non-existent-thread'
      };

      await expect(factory.createBuilder(params)).rejects.toThrow('Thread not found');
    });
  });

  describe('Agent 不存在', () => {
    it('应该抛出错误', async () => {
      // 设置一个有效的 Thread，但引用不存在的 Agent
      const mockThread: ThreadDefinition = {
        id: 'thread-123',
        agentId: 'non-existent-agent',
        title: 'Test Thread',
        status: 'active',
        sessionId: 'thread-123',
        agentMode: 'agent',
        runStatus: 'idle',
        agentHomePath: '/mock/home/agents/non-existent-agent',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      mockThreads.set('thread-123', mockThread);

      const params: CreateBuilderParams = {
        threadId: 'thread-123'
      };

      await expect(factory.createBuilder(params)).rejects.toThrow('Agent not found');
    });
  });

  describe('正常场景', () => {
    it('应该正确创建 Builder', async () => {
      // 设置 mock 数据
      const mockAgent: AgentDefinition = {
        id: 'agent-123',
        name: 'Test Agent',
        description: 'Test',
        instructions: 'You are a test agent',
        model: 'openai/gpt-4',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'user',
        version: 1
      };
      mockAgents.set('agent-123', mockAgent);

      const mockThread: ThreadDefinition = {
        id: 'thread-456',
        agentId: 'agent-123',
        title: 'Test Thread',
        status: 'active',
        sessionId: 'thread-456',
        agentMode: 'agent',
        runStatus: 'idle',
        agentHomePath: '/mock/home/agents/agent-123',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      mockThreads.set('thread-456', mockThread);

      const mockContext: AgentContext = {
        agentId: 'agent-123',
        agentName: 'Test Agent',
        agentHomePath: '/mock/home/agents/agent-123',
        dataDirectory: '/mock/data/agent-123',
        workspacePath: undefined,
        effectiveModel: 'openai/gpt-4',
        sessionDir: '/mock/data/agent-123/sessions/thread-456',
        sessionId: 'thread-456'
      };
      mockContextResolver.resolve.mockResolvedValue(mockContext);

      // 执行
      const params: CreateBuilderParams = {
        threadId: 'thread-456'
      };

      const builder = await factory.createBuilder(params);

      // 验证
      expect(builder).toBe(mockBuilder);
      expect(mockAgentExecutor.piMono).toHaveBeenCalled();
      expect(mockBuilder.sessionMode).toHaveBeenCalledWith('file');
      expect(mockBuilder.agentId).toHaveBeenCalledWith('agent-123');
      expect(mockBuilder.name).toHaveBeenCalledWith('agent-123');
      expect(mockAgentExecutor.applyProviderConfig).toHaveBeenCalledWith(mockBuilder, {
        modelOverride: 'openai/gpt-4',
        sessionId: 'thread-456',
        agentId: 'agent-123'
      });
      expect(mockBuilder.instructions).toHaveBeenCalledWith('You are a test agent');
    });

    it('应该支持自定义 sessionMode', async () => {
      const mockAgent: AgentDefinition = {
        id: 'agent-789',
        name: 'Test Agent',
        description: 'Test',
        instructions: '',
        model: 'openai/gpt-4',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'user',
        version: 1
      };
      mockAgents.set('agent-789', mockAgent);

      const mockThread: ThreadDefinition = {
        id: 'thread-789',
        agentId: 'agent-789',
        title: 'Test Thread',
        status: 'active',
        sessionId: 'thread-789',
        agentMode: 'agent',
        runStatus: 'idle',
        agentHomePath: '/mock/home/agents/agent-789',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      mockThreads.set('thread-789', mockThread);

      const mockContext: AgentContext = {
        agentId: 'agent-789',
        agentName: 'Test Agent',
        agentHomePath: '/mock/home/agents/agent-789',
        dataDirectory: '/mock/data/agent-789',
        workspacePath: undefined,
        effectiveModel: 'openai/gpt-4',
        sessionDir: '/mock/data/agent-789/sessions/thread-789',
        sessionId: 'thread-789'
      };
      mockContextResolver.resolve.mockResolvedValue(mockContext);

      // 使用 memory 模式
      const params: CreateBuilderParams = {
        threadId: 'thread-789',
        sessionMode: 'memory'
      };

      await factory.createBuilder(params);

      expect(mockBuilder.sessionMode).toHaveBeenCalledWith('memory');
    });

    it('应该使用 Thread 的 overrideModel', async () => {
      const mockAgent: AgentDefinition = {
        id: 'agent-override',
        name: 'Test Agent',
        description: 'Test',
        instructions: '',
        model: 'openai/gpt-4',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'user',
        version: 1
      };
      mockAgents.set('agent-override', mockAgent);

      const mockThread: ThreadDefinition = {
        id: 'thread-override',
        agentId: 'agent-override',
        title: 'Test Thread',
        status: 'active',
        sessionId: 'thread-override',
        agentMode: 'agent',
        runStatus: 'idle',
        agentHomePath: '/mock/home/agents/agent-override',
        overrideModel: 'anthropic/claude-3-5-sonnet',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      mockThreads.set('thread-override', mockThread);

      const mockContext: AgentContext = {
        agentId: 'agent-override',
        agentName: 'Test Agent',
        agentHomePath: '/mock/home/agents/agent-override',
        dataDirectory: '/mock/data/agent-override',
        workspacePath: undefined,
        effectiveModel: 'anthropic/claude-3-5-sonnet',
        sessionDir: '/mock/data/agent-override/sessions/thread-override',
        sessionId: 'thread-override'
      };
      mockContextResolver.resolve.mockResolvedValue(mockContext);

      const params: CreateBuilderParams = {
        threadId: 'thread-override'
      };

      await factory.createBuilder(params);

      expect(mockAgentExecutor.applyProviderConfig).toHaveBeenCalledWith(
        mockBuilder,
        expect.objectContaining({
          modelOverride: 'anthropic/claude-3-5-sonnet'
        })
      );
    });

    it('应该保留空字符串的 instructions', async () => {
      const mockAgent: AgentDefinition = {
        id: 'agent-empty',
        name: 'Test Agent',
        description: 'Test',
        instructions: '',
        model: 'openai/gpt-4',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'user',
        version: 1
      };
      mockAgents.set('agent-empty', mockAgent);

      const mockThread: ThreadDefinition = {
        id: 'thread-empty',
        agentId: 'agent-empty',
        title: 'Test Thread',
        status: 'active',
        sessionId: 'thread-empty',
        agentMode: 'agent',
        runStatus: 'idle',
        agentHomePath: '/mock/home/agents/agent-empty',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      mockThreads.set('thread-empty', mockThread);

      const mockContext: AgentContext = {
        agentId: 'agent-empty',
        agentName: 'Test Agent',
        agentHomePath: '/mock/home/agents/agent-empty',
        dataDirectory: '/mock/data/agent-empty',
        workspacePath: undefined,
        effectiveModel: 'openai/gpt-4',
        sessionDir: '/mock/data/agent-empty/sessions/thread-empty',
        sessionId: 'thread-empty'
      };
      mockContextResolver.resolve.mockResolvedValue(mockContext);

      const params: CreateBuilderParams = {
        threadId: 'thread-empty'
      };

      await factory.createBuilder(params);

      // 空字符串是用户显式配置，不能被默认指令覆盖
      expect(mockBuilder.instructions).toHaveBeenCalledWith('');
    });

    it('应该处理没有 model 的情况', async () => {
      const mockAgent: AgentDefinition = {
        id: 'agent-no-model',
        name: 'Test Agent',
        description: 'Test',
        instructions: 'Test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'user',
        version: 1
      };
      mockAgents.set('agent-no-model', mockAgent);

      const mockThread: ThreadDefinition = {
        id: 'thread-no-model',
        agentId: 'agent-no-model',
        title: 'Test Thread',
        status: 'active',
        sessionId: 'thread-no-model',
        agentMode: 'agent',
        runStatus: 'idle',
        agentHomePath: '/mock/home/agents/agent-no-model',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      mockThreads.set('thread-no-model', mockThread);

      const mockContext: AgentContext = {
        agentId: 'agent-no-model',
        agentName: 'Test Agent',
        agentHomePath: '/mock/home/agents/agent-no-model',
        dataDirectory: '/mock/data/agent-no-model',
        workspacePath: undefined,
        effectiveModel: undefined, // 没有模型
        sessionDir: '/mock/data/agent-no-model/sessions/thread-no-model',
        sessionId: 'thread-no-model'
      };
      mockContextResolver.resolve.mockResolvedValue(mockContext);

      const params: CreateBuilderParams = {
        threadId: 'thread-no-model'
      };

      await factory.createBuilder(params);

      // 没有模型时不应该调用 applyProviderConfig
      expect(mockAgentExecutor.applyProviderConfig).not.toHaveBeenCalled();
    });
  });

  describe('ContextResolver 集成', () => {
    it('应该调用 ContextResolver.resolve', async () => {
      const mockAgent: AgentDefinition = {
        id: 'agent-ctx',
        name: 'Test Agent',
        description: 'Test',
        instructions: '',
        model: 'openai/gpt-4',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'user',
        version: 1
      };
      mockAgents.set('agent-ctx', mockAgent);

      const mockThread: ThreadDefinition = {
        id: 'thread-ctx',
        agentId: 'agent-ctx',
        title: 'Test Thread',
        status: 'active',
        sessionId: 'thread-ctx',
        agentMode: 'agent',
        runStatus: 'idle',
        agentHomePath: '/mock/home/agents/agent-ctx',
        overrideModel: 'custom/model',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {
          workspacePath: '/custom/workspace'
        }
      };
      mockThreads.set('thread-ctx', mockThread);

      const mockContext: AgentContext = {
        agentId: 'agent-ctx',
        agentName: 'Test Agent',
        agentHomePath: '/mock/home/agents/agent-ctx',
        dataDirectory: '/mock/data/agent-ctx',
        workspacePath: '/custom/workspace',
        effectiveModel: 'custom/model',
        sessionDir: '/mock/data/agent-ctx/sessions/thread-ctx',
        sessionId: 'thread-ctx'
      };
      mockContextResolver.resolve.mockResolvedValue(mockContext);

      const params: CreateBuilderParams = {
        threadId: 'thread-ctx'
      };

      await factory.createBuilder(params);

      // 验证 ContextResolver.resolve 被正确调用
      expect(mockContextResolver.resolve).toHaveBeenCalledWith({
        agentId: 'agent-ctx',
        sessionId: 'thread-ctx',
        threadId: 'thread-ctx',
        workspace: '/custom/workspace',
        modelOverride: 'custom/model'
      });
    });
  });
});
