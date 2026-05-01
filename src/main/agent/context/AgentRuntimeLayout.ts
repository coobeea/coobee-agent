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
  agentHomePath: string;
  /** Agent 项目目录（{agentHome}/project），工具默认 cwd */
  agentProjectPath: string;
  /** @alias agentProjectPath */
  projectPath: string;
  /** 会话根目录（{agentHome}/sessions） */
  sessionRoot: string;
  /** 当前会话产物目录（{sessionRoot}/{sessionId}） */
  sessionDir: string;
  /** 会话文件子目录（{sessionDir}/sessions），SDK 内部使用 */
  sessionFilesDir: string;
  /** Agent 专属技能目录（{agentHome}/skills） */
  agentSkillsPath: string;
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

  const agentHomePath = path.join(Env.paths.agentsDir, agentId);
  const agentProjectPath = path.join(agentHomePath, 'project');
  const sessionRoot = path.join(agentHomePath, 'sessions');
  const sessionDir = path.join(sessionRoot, sessionId);

  return {
    agentId,
    sessionId,
    agentHomePath,
    agentProjectPath,
    projectPath: agentProjectPath,
    sessionRoot,
    sessionDir,
    sessionFilesDir: path.join(sessionDir, 'sessions'),
    agentSkillsPath: path.join(agentHomePath, 'skills')
  };
}

export async function ensureAgentRuntimeLayout(options: ResolveAgentRuntimeLayoutOptions): Promise<AgentRuntimeLayout> {
  const layout = createAgentRuntimeLayout(options);
  await Promise.all([
    fsp.mkdir(layout.agentHomePath, { recursive: true }),
    fsp.mkdir(layout.agentProjectPath, { recursive: true }),
    fsp.mkdir(layout.sessionRoot, { recursive: true }),
    fsp.mkdir(layout.sessionDir, { recursive: true }),
    fsp.mkdir(layout.sessionFilesDir, { recursive: true }),
    fsp.mkdir(layout.agentSkillsPath, { recursive: true })
  ]);
  return layout;
}

export function ensureAgentRuntimeLayoutSync(options: ResolveAgentRuntimeLayoutOptions): AgentRuntimeLayout {
  const layout = createAgentRuntimeLayout(options);
  fs.mkdirSync(layout.agentHomePath, { recursive: true });
  fs.mkdirSync(layout.agentProjectPath, { recursive: true });
  fs.mkdirSync(layout.sessionRoot, { recursive: true });
  fs.mkdirSync(layout.sessionDir, { recursive: true });
  fs.mkdirSync(layout.sessionFilesDir, { recursive: true });
  fs.mkdirSync(layout.agentSkillsPath, { recursive: true });
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
