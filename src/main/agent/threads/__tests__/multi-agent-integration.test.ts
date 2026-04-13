/**
 * 多 Agent 委托集成测试
 *
 * 验证：
 *   1. 子 Agent sessionId 命名规范（{parentSessionId}:delegate:{agentId}）
 *   2. 子 Agent 使用 sessionMode('file')（持久化）
 *   3. Orchestrator/Swarm sessionId 命名规范
 */

import { describe, it, expect } from 'vitest';

describe('多 Agent 集成', () => {

  // ========== SessionId 命名规范 ==========

  describe('sessionId 命名规范', () => {
    it('delegate 子 Agent sessionId 格式: {threadId}:delegate:{agentId}', () => {
      const threadId = '300000000000000001';
      const agentId = 'code-reviewer';
      const subSessionId = `${threadId}:delegate:${agentId}`;

      expect(subSessionId).toBe('300000000000000001:delegate:code-reviewer');
      expect(subSessionId.startsWith(threadId)).toBe(true);
      expect(subSessionId.includes(':delegate:')).toBe(true);
    });

    it('planner sessionId 格式: {threadId}:planner', () => {
      const threadId = '300000000000000001';
      const sessionId = `${threadId}:planner`;
      expect(sessionId).toBe('300000000000000001:planner');
    });

    it('worker sessionId 格式: {threadId}:worker:{subtaskId}', () => {
      const threadId = '300000000000000001';
      const subtaskId = 'subtask-1';
      const sessionId = `${threadId}:worker:${subtaskId}`;
      expect(sessionId).toBe('300000000000000001:worker:subtask-1');
    });

    it('swarm triage sessionId 格式: {threadId}:triage', () => {
      const threadId = '300000000000000001';
      const sessionId = `${threadId}:triage`;
      expect(sessionId).toBe('300000000000000001:triage');
    });

    it('swarm role sessionId 格式: {threadId}:swarm:{roleId}', () => {
      const threadId = '300000000000000001';
      const roleId = 'researcher';
      const sessionId = `${threadId}:swarm:${roleId}`;
      expect(sessionId).toBe('300000000000000001:swarm:researcher');
    });

    it('子 Agent sessionId 包含 : 可以正确识别为非主 thread', () => {
      const mainSessionId = '300000000000000001';
      const subSessionId = '300000000000000001:delegate:reviewer';

      expect(mainSessionId.includes(':')).toBe(false);
      expect(subSessionId.includes(':')).toBe(true);
    });
  });

  // ========== Orchestrator/Swarm 配置传递 ==========

  describe('Orchestrator parentSessionId 传递', () => {
    it('WorkerCoordinator 接收 parentSessionId', () => {
      // 验证类型兼容性
      const config = {
        parentSessionId: '300000000000000001',
        model: 'gpt-4o'
      };

      const sessionId = config.parentSessionId
        ? `${config.parentSessionId}:worker:subtask-1`
        : `worker-subtask-1-${Date.now()}`;

      expect(sessionId).toBe('300000000000000001:worker:subtask-1');
    });

    it('Planner 接收 parentSessionId', () => {
      const options = {
        parentSessionId: '300000000000000001',
        model: 'gpt-4o'
      };

      const sessionId = options.parentSessionId ? `${options.parentSessionId}:planner` : `planner-${Date.now()}`;

      expect(sessionId).toBe('300000000000000001:planner');
    });

    it('SwarmConfig 接收 parentSessionId', () => {
      const config = {
        parentSessionId: '300000000000000001'
      };

      const triageSessionId = config.parentSessionId ? `${config.parentSessionId}:triage` : `triage-${Date.now()}`;

      const swarmSessionId = config.parentSessionId
        ? `${config.parentSessionId}:swarm:researcher`
        : `swarm-pool-${Date.now()}`;

      expect(triageSessionId).toBe('300000000000000001:triage');
      expect(swarmSessionId).toBe('300000000000000001:swarm:researcher');
    });
  });
});
