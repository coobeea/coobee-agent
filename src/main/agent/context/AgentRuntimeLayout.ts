import fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import { Env } from '@main/common/env';

export interface AgentRuntimeLayout {
  /** Agent 定义 ID */
  agentId: string;
  /** 会话 ID */
  sessionId: string;
  /** Agent Home 目录（{agentsDir}/{agentId}） */
  agentHome: string;
  /** Agent 项目目录（{agentHome}/project），工具默认 cwd */
  projectDir: string;
  /** 记忆目录（{agentHome}/memory） */
  memoryDir: string;
  /** 会话目录（{agentHome}/sessions） */
  sessionsDir: string;
  /** 当前会话产物目录（{agentHome}/sessions/{sessionId}） */
  sessionDir: string;
  /** 技能目录（{agentHome}/skills） */
  skillsDir: string;
}

export interface ResolveAgentRuntimeLayoutOptions {
  /** Agent 定义 ID */
  agentId: string;
  /** 会话 ID */
  sessionId: string;
}

export function createAgentRuntimeLayout(options: ResolveAgentRuntimeLayoutOptions): AgentRuntimeLayout {
  const { agentId, sessionId } = options;
  if (!agentId || !agentId.trim()) {
    throw new Error('[AgentRuntimeLayout] agentId is required');
  }
  if (!sessionId || !sessionId.trim()) {
    throw new Error('[AgentRuntimeLayout] sessionId is required');
  }

  const agentHome = path.join(Env.paths.agentsDir, agentId);
  const projectDir = path.join(agentHome, 'project');
  const memoryDir = path.join(agentHome, 'memory');
  const sessionsDir = path.join(agentHome, 'sessions');
  const sessionDir = path.join(sessionsDir, sessionId);
  const skillsDir = path.join(agentHome, 'skills');

  return {
    agentId,
    sessionId,
    agentHome,
    projectDir,
    memoryDir,
    sessionsDir,
    sessionDir,
    skillsDir
  };
}

export async function ensureAgentRuntimeLayout(options: ResolveAgentRuntimeLayoutOptions): Promise<AgentRuntimeLayout> {
  const layout = createAgentRuntimeLayout(options);
  await Promise.all([
    fsp.mkdir(layout.agentHome, { recursive: true }),
    fsp.mkdir(layout.projectDir, { recursive: true }),
    fsp.mkdir(layout.memoryDir, { recursive: true }),
    fsp.mkdir(layout.sessionsDir, { recursive: true }),
    fsp.mkdir(layout.sessionDir, { recursive: true }),
    fsp.mkdir(layout.skillsDir, { recursive: true })
  ]);
  return layout;
}

export function ensureAgentRuntimeLayoutSync(options: ResolveAgentRuntimeLayoutOptions): AgentRuntimeLayout {
  const layout = createAgentRuntimeLayout(options);
  fs.mkdirSync(layout.agentHome, { recursive: true });
  fs.mkdirSync(layout.projectDir, { recursive: true });
  fs.mkdirSync(layout.memoryDir, { recursive: true });
  fs.mkdirSync(layout.sessionsDir, { recursive: true });
  fs.mkdirSync(layout.sessionDir, { recursive: true });
  fs.mkdirSync(layout.skillsDir, { recursive: true });
  return layout;
}

export function resolveThreadRuntimeLayoutSync(sessionId: string, fallbackAgentId?: string): AgentRuntimeLayout {
  const thread = readThreadDefinitionSync(sessionId);
  const agentId = typeof thread?.agentId === 'string' && thread.agentId ? thread.agentId : fallbackAgentId;

  if (!agentId) {
    throw new Error(`[AgentRuntimeLayout] Cannot resolve agentId for session ${sessionId}`);
  }

  return ensureAgentRuntimeLayoutSync({
    agentId,
    sessionId
  });
}

function readThreadDefinitionSync(sessionId: string): Record<string, unknown> | null {
  const filePath = path.join(Env.paths.threadsDir, `${sessionId}.json`);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}
