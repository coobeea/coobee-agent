/**
 * TestToolContext — 测试专用 ToolExecutionContext 工厂
 *
 * 用于在单元/集成测试中快速构造符合类型约束的 ToolExecutionContext，
 * 所有默认路径落在传入的 workspaceRoot 下，sessionDir 按 sessionId 隔离。
 */
import path from 'node:path';
import os from 'node:os';
import type { ToolExecutionContext } from '../types';

export interface CreateTestToolContextOptions {
  /** 工作区根目录（必填） */
  workspaceRoot: string;
  /** 会话 ID，默认 'test-session' */
  sessionId?: string;
}

/**
 * 创建测试用 ToolExecutionContext
 */
export function createTestToolContext(options: CreateTestToolContextOptions): ToolExecutionContext {
  const { workspaceRoot } = options;
  const sessionId = options.sessionId ?? 'test-session';
  const sessionDir = path.join(workspaceRoot, 'sessions', sessionId);
  const userHome = path.join(os.tmpdir(), 'coobee-test-home');

  return {
    mode: 'path-only',
    workspaceRoot,
    toolPolicy: { allow: [], deny: [], confirm: [] },

    sessionId,
    threadId: sessionId,

    cwd: workspaceRoot,

    sessionDir,
    sessionsDir: path.join(sessionDir, 'sessions'),
    contextsDir: sessionDir,
    eventsDir: sessionDir,

    userHome,
    configDir: path.join(userHome, 'config'),
    tempDir: os.tmpdir(),

    agentName: 'test-agent',
    agentMode: 'agent'
  };
}
