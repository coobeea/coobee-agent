/**
 * AgentContextResolver 单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentContextResolver, type ResolveParams } from '../AgentContextResolver';
import type { AgentDefinition } from '../../agents/types';

const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn<(filePath: string) => boolean>(() => false),
  mkdir: vi.fn<() => Promise<void>>(async () => undefined),
  readdir: vi.fn<() => Promise<string[]>>(async () => []),
  rename: vi.fn<() => Promise<void>>(async () => undefined),
  cp: vi.fn<() => Promise<void>>(async () => undefined),
  rm: vi.fn<() => Promise<void>>(async () => undefined),
  rmdir: vi.fn<() => Promise<void>>(async () => undefined)
}));

type MockAgentStore = {
  _setMockAgent(agent: AgentDefinition): void;
  _clearMockAgents(): void;
};

async function getMockAgentStore(): Promise<MockAgentStore> {
  const { AgentStore } = await import('@main/agent/agents/AgentStore');
  return (await AgentStore.getInstance()) as unknown as MockAgentStore;
}

// Mock dependencies
vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

vi.mock('node:fs', () => ({
  default: {
    existsSync: fsMocks.existsSync,
    promises: {
      mkdir: fsMocks.mkdir
    }
  },
  existsSync: fsMocks.existsSync
}));

vi.mock('node:fs/promises', () => ({
  mkdir: fsMocks.mkdir,
  readdir: fsMocks.readdir,
  rename: fsMocks.rename,
  cp: fsMocks.cp,
  rm: fsMocks.rm,
  rmdir: fsMocks.rmdir
}));

vi.mock('@main/agent/agents/AgentStore', () => {
  const mockAgents = new Map<string, AgentDefinition>();

  return {
    AgentStore: {
      getInstance: vi.fn().mockReturnValue({
        get: vi.fn(async (id: string) => mockAgents.get(id)),
        _setMockAgent: (agent: AgentDefinition) => mockAgents.set(agent.id, agent),
        _clearMockAgents: () => mockAgents.clear()
      })
    }
  };
});

vi.mock('@main/agent/agents/AgentHomeManager', () => ({
  AgentHomeManager: vi.fn().mockImplementation(function (this: { initHome: (agentId: string) => string }) {
    this.initHome = vi.fn((agentId: string) => `/mock/home/agents/${agentId}`);
  })
}));

vi.mock('@main/common/env', () => ({
  Env: {
    paths: {
      userHome: '/mock/home',
      agentsDir: '/mock/home/agents',
      threadsDir: '/mock/home/threads',
      home: '/mock/system/home',
      temp: '/tmp'
    }
  }
}));

describe('AgentContextResolver', () => {
  let resolver: AgentContextResolver;

  beforeEach(async () => {
    // 重置单例
    AgentContextResolver.resetInstance();
    resolver = AgentContextResolver.getInstance();
    resolver.clearCache();

    // 清理 mock agents
    const store = await getMockAgentStore();
    store._clearMockAgents();

    vi.clearAllMocks();
    fsMocks.existsSync.mockReturnValue(false);
    fsMocks.mkdir.mockResolvedValue(undefined);
    fsMocks.readdir.mockResolvedValue([]);
    fsMocks.rename.mockResolvedValue(undefined);
    fsMocks.cp.mockResolvedValue(undefined);
    fsMocks.rm.mockResolvedValue(undefined);
    fsMocks.rmdir.mockResolvedValue(undefined);
  });

  describe('参数验证', () => {
    it('应该拒绝空的 agentId', async () => {
      const params: ResolveParams = {
        agentId: '',
        sessionId: 'session-123'
      };

      await expect(resolver.resolve(params)).rejects.toThrow('agentId is required');
    });

    it('应该拒绝空的 sessionId', async () => {
      const params: ResolveParams = {
        agentId: 'agent-123',
        sessionId: ''
      };

      await expect(resolver.resolve(params)).rejects.toThrow('sessionId is required');
    });

    it('应该拒绝只包含空格的 agentId', async () => {
      const params: ResolveParams = {
        agentId: '   ',
        sessionId: 'session-123'
      };

      await expect(resolver.resolve(params)).rejects.toThrow('agentId is required');
    });
  });

  describe('Agent 不存在', () => {
    it('应该抛出错误', async () => {
      const params: ResolveParams = {
        agentId: 'non-existent-agent',
        sessionId: 'session-123'
      };

      await expect(resolver.resolve(params)).rejects.toThrow('Agent not found: non-existent-agent');
    });
  });

  describe('正常场景', () => {
    it('应该正确解析 Agent 上下文', async () => {
      // 设置 mock agent
      const store = await getMockAgentStore();
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
      store._setMockAgent(mockAgent);

      const params: ResolveParams = {
        agentId: 'agent-123',
        sessionId: 'session-456'
      };

      const context = await resolver.resolve(params);

      expect(context.agentId).toBe('agent-123');
      expect(context.agentName).toBe('Test Agent');
      expect(context.agentHomePath).toBe('/mock/home/agents/agent-123');
      expect(context.projectPath).toBe('/mock/home/agents/agent-123/project');
      expect(context.agentProjectPath).toBe('/mock/home/agents/agent-123/project');
      expect(context.effectiveModel).toBe('openai/gpt-4');
      expect(context.sessionId).toBe('session-456');
      expect(context.sessionDir).toBe('/mock/home/agents/agent-123/sessions/session-456');
      expect(context.agentSkillsPath).toBe('/mock/home/agents/agent-123/skills');
      expect(fsMocks.mkdir).toHaveBeenCalledWith('/mock/home/agents/agent-123/project', { recursive: true });
    });

    it('应该正确解析 Agent 上下文（无自定义 dataDirectory）', async () => {
      const store = await getMockAgentStore();
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
        // 没有 metadata.dataDirectory
      };
      store._setMockAgent(mockAgent);

      const params: ResolveParams = {
        agentId: 'agent-789',
        sessionId: 'session-111'
      };

      const context = await resolver.resolve(params);

      expect(context.sessionDir).toBe('/mock/home/agents/agent-789/sessions/session-111');
      expect(fsMocks.mkdir).toHaveBeenCalledWith('/mock/home/agents/agent-789/project', { recursive: true });
    });

    it('创建运行目录失败时应该抛出错误', async () => {
      const store = await getMockAgentStore();
      const mockAgent: AgentDefinition = {
        id: 'agent-mkdir-fail',
        name: 'Test Agent',
        description: 'Test',
        instructions: '',
        model: 'openai/gpt-4',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'user',
        version: 1
      };
      store._setMockAgent(mockAgent);
      fsMocks.mkdir.mockRejectedValueOnce(new Error('permission denied'));

      await expect(
        resolver.resolve({
          agentId: 'agent-mkdir-fail',
          sessionId: 'session-mkdir-fail'
        })
      ).rejects.toThrow('permission denied');
    });

    it('应该一次性迁移旧 data 和 workspaces 目录内容到新布局', async () => {
      const store = await getMockAgentStore();
      const mockAgent: AgentDefinition = {
        id: 'agent-migrate',
        name: 'Test Agent',
        description: 'Test',
        instructions: '',
        model: 'openai/gpt-4',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'user',
        version: 1
      };
      store._setMockAgent(mockAgent);

      fsMocks.existsSync.mockImplementation((filePath: string) =>
        ['/mock/home/data/agent-migrate', '/mock/home/workspaces/session-migrate'].includes(filePath)
      );
      fsMocks.readdir
        .mockResolvedValueOnce(['records.json'])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(['history.jsonl'])
        .mockResolvedValueOnce([]);

      await resolver.resolve({
        agentId: 'agent-migrate',
        sessionId: 'session-migrate'
      });

      expect(fsMocks.rename).toHaveBeenCalledWith(
        '/mock/home/data/agent-migrate/records.json',
        '/mock/home/agents/agent-migrate/project/records.json'
      );
      expect(fsMocks.rename).toHaveBeenCalledWith(
        '/mock/home/workspaces/session-migrate/history.jsonl',
        '/mock/home/agents/agent-migrate/sessions/session-migrate/history.jsonl'
      );
    });

    it('应该使用 modelOverride', async () => {
      const store = await getMockAgentStore();
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
      store._setMockAgent(mockAgent);

      const params: ResolveParams = {
        agentId: 'agent-override',
        sessionId: 'session-222',
        modelOverride: 'anthropic/claude-3-5-sonnet'
      };

      const context = await resolver.resolve(params);

      expect(context.effectiveModel).toBe('anthropic/claude-3-5-sonnet');
    });

    it('应该忽略空字符串的 modelOverride', async () => {
      const store = await getMockAgentStore();
      const mockAgent: AgentDefinition = {
        id: 'agent-empty-model',
        name: 'Test Agent',
        description: 'Test',
        instructions: '',
        model: 'openai/gpt-4',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'user',
        version: 1
      };
      store._setMockAgent(mockAgent);

      const params: ResolveParams = {
        agentId: 'agent-empty-model',
        sessionId: 'session-333',
        modelOverride: '   ' // 空字符串
      };

      const context = await resolver.resolve(params);

      expect(context.effectiveModel).toBe('openai/gpt-4');
    });

    it('应该忽略旧版模型组配置', async () => {
      const store = await getMockAgentStore();
      const mockAgent: AgentDefinition = {
        id: 'agent-legacy-model',
        name: 'Test Agent',
        description: 'Test',
        instructions: '',
        model: '@group:default',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'user',
        version: 1
      };
      store._setMockAgent(mockAgent);

      const params: ResolveParams = {
        agentId: 'agent-legacy-model',
        sessionId: 'session-legacy',
        modelOverride: '@group:default'
      };

      const context = await resolver.resolve(params);

      expect(context.effectiveModel).toBeUndefined();
    });
  });

  describe('缓存机制', () => {
    it('应该缓存解析结果', async () => {
      const store = await getMockAgentStore();
      const mockAgent: AgentDefinition = {
        id: 'agent-cache',
        name: 'Test Agent',
        description: 'Test',
        instructions: '',
        model: 'openai/gpt-4',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'user',
        version: 1
      };
      store._setMockAgent(mockAgent);

      const params: ResolveParams = {
        agentId: 'agent-cache',
        sessionId: 'session-cache'
      };

      // 第一次调用
      const context1 = await resolver.resolve(params);

      // 第二次调用（应该使用缓存）
      const context2 = await resolver.resolve(params);

      expect(context1).toEqual(context2);
      expect(context1).toBe(context2); // 同一个对象引用
    });

    it('clearCache 应该清空缓存', async () => {
      const store = await getMockAgentStore();
      const mockAgent: AgentDefinition = {
        id: 'agent-clear',
        name: 'Test Agent',
        description: 'Test',
        instructions: '',
        model: 'openai/gpt-4',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'user',
        version: 1
      };
      store._setMockAgent(mockAgent);

      const params: ResolveParams = {
        agentId: 'agent-clear',
        sessionId: 'session-clear'
      };

      // 第一次调用
      await resolver.resolve(params);

      // 清空缓存
      resolver.clearCache();

      // 第二次调用（应该重新解析）
      const { AgentHomeManager } = await import('@main/agent/agents/AgentHomeManager');
      const managerConstructorSpy = vi.mocked(AgentHomeManager);
      managerConstructorSpy.mockClear();

      await resolver.resolve(params);

      // 验证 AgentHomeManager 被构造（说明重新解析了）
      expect(managerConstructorSpy).toHaveBeenCalled();
    });
  });

  describe('项目目录路径', () => {
    it('应该忽略外部 workspace 参数，使用 Agent project', async () => {
      const store = await getMockAgentStore();
      const mockAgent: AgentDefinition = {
        id: 'agent-valid-path',
        name: 'Test Agent',
        description: 'Test',
        instructions: '',
        model: 'openai/gpt-4',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'user',
        version: 1
      };
      store._setMockAgent(mockAgent);

      const params: ResolveParams = {
        agentId: 'agent-valid-path',
        sessionId: 'session-path',
        workspace: '/mock/home/workspace/project'
      };

      const context = await resolver.resolve(params);

      expect(context.projectPath).toBe('/mock/home/agents/agent-valid-path/project');
      expect(context.workspacePath).toBe('/mock/home/agents/agent-valid-path/project');
    });

    it('不应该让路径遍历参数改变 Agent project', async () => {
      const store = await getMockAgentStore();
      const mockAgent: AgentDefinition = {
        id: 'agent-attack',
        name: 'Test Agent',
        description: 'Test',
        instructions: '',
        model: 'openai/gpt-4',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'user',
        version: 1
      };
      store._setMockAgent(mockAgent);

      const params: ResolveParams = {
        agentId: 'agent-attack',
        sessionId: 'session-attack',
        workspace: '/mock/home/../../../etc/passwd'
      };

      const context = await resolver.resolve(params);

      expect(context.projectPath).toBe('/mock/home/agents/agent-attack/project');
      expect(context.workspacePath).toBe('/mock/home/agents/agent-attack/project');
    });
  });

  describe('单例模式', () => {
    it('应该返回同一个实例', () => {
      const instance1 = AgentContextResolver.getInstance();
      const instance2 = AgentContextResolver.getInstance();

      expect(instance1).toBe(instance2);
    });
  });
});
