/**
 * Agent 主动发送给前端的统一消息契约。
 *
 * 外层事件固定为 agent:message，具体 UI 行为由 action 分发。
 */

export const AgentEventTypes = {
  MESSAGE: 'agent:message'
} as const;

export type AgentEventType = (typeof AgentEventTypes)[keyof typeof AgentEventTypes];

export const BuiltinAgentMessageActions = {
  NOTIFY: 'notify',
  OPEN_PREVIEW: 'open-preview',
  OPEN_FILE: 'open-file'
} as const;

export type BuiltinAgentMessageAction = (typeof BuiltinAgentMessageActions)[keyof typeof BuiltinAgentMessageActions];

export type AgentMessageAction = BuiltinAgentMessageAction | (string & {});

export type AgentMessageLevel = 'info' | 'success' | 'warning' | 'error';

export interface AgentMessagePayload {
  /** 给用户看的主要文本，例如通知文案、预览标题、文件说明 */
  text?: string;
  /** 给程序执行用的结构化参数，例如 url/path/level */
  data?: Record<string, unknown>;
}

export interface AgentMessageMeta {
  sessionId?: string;
  agentName?: string;
}

export interface AgentMessage {
  type: typeof AgentEventTypes.MESSAGE;
  action: AgentMessageAction;
  payload: AgentMessagePayload;
  meta: AgentMessageMeta;
  timestamp: number;
}

export type NormalizeAgentMessageResult = AgentMessage | { error: string };

const BUILTIN_ACTIONS = new Set<string>(Object.values(BuiltinAgentMessageActions));
const MESSAGE_LEVELS = new Set<AgentMessageLevel>(['info', 'success', 'warning', 'error']);
const PAYLOAD_KEYS = new Set(['text', 'data']);

export function isBuiltinAgentMessageAction(action: string): action is BuiltinAgentMessageAction {
  return BUILTIN_ACTIONS.has(action);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePayload(payload: unknown): AgentMessagePayload | { error: string } {
  if (payload === undefined || payload === null) {
    return {};
  }

  if (!isRecord(payload)) {
    return { error: 'payload must be an object with optional text and data fields' };
  }

  const extraKeys = Object.keys(payload).filter((key) => !PAYLOAD_KEYS.has(key));
  if (extraKeys.length > 0) {
    return { error: `payload only supports text and data fields, got: ${extraKeys.join(', ')}` };
  }

  const normalized: AgentMessagePayload = {};

  if (payload.text !== undefined) {
    if (typeof payload.text !== 'string') {
      return { error: 'payload.text must be a string' };
    }
    const text = payload.text.trim();
    if (text) {
      normalized.text = text;
    }
  }

  if (payload.data !== undefined) {
    if (!isRecord(payload.data)) {
      return { error: 'payload.data must be an object' };
    }
    normalized.data = { ...payload.data };
  }

  return normalized;
}

function getRequiredDataString(payload: AgentMessagePayload, key: string, action: string): string | { error: string } {
  const value = payload.data?.[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { error: `${action} requires payload.data.${key} to be a non-empty string` };
  }
  return value.trim();
}

function getMessageLevel(payload: AgentMessagePayload): AgentMessageLevel | { error: string } {
  const level = payload.data?.level;
  if (level === undefined) {
    return 'info';
  }
  if (typeof level !== 'string' || !MESSAGE_LEVELS.has(level as AgentMessageLevel)) {
    return { error: 'notify payload.data.level must be one of: info, success, warning, error' };
  }
  return level as AgentMessageLevel;
}

function normalizeMeta(meta?: AgentMessageMeta): AgentMessageMeta {
  return {
    ...(typeof meta?.sessionId === 'string' && meta.sessionId.trim() ? { sessionId: meta.sessionId } : {}),
    ...(typeof meta?.agentName === 'string' && meta.agentName.trim() ? { agentName: meta.agentName } : {})
  };
}

export function normalizeAgentMessage(
  action: string,
  payload: unknown,
  meta?: AgentMessageMeta
): NormalizeAgentMessageResult {
  const normalizedAction = action.trim();
  if (!normalizedAction) {
    return { error: 'action must be a non-empty string' };
  }

  if (!isBuiltinAgentMessageAction(normalizedAction)) {
    return {
      error: `unsupported action "${normalizedAction}". Supported actions: ${Object.values(BuiltinAgentMessageActions).join(', ')}`
    };
  }

  const normalizedPayload = normalizePayload(payload);
  if ('error' in normalizedPayload) {
    return normalizedPayload;
  }

  if (normalizedAction === BuiltinAgentMessageActions.NOTIFY) {
    if (!normalizedPayload.text) {
      return { error: 'notify requires payload.text to be a non-empty string' };
    }
    const level = getMessageLevel(normalizedPayload);
    if (typeof level !== 'string') {
      return level;
    }
    normalizedPayload.data = { ...normalizedPayload.data, level };
  }

  if (normalizedAction === BuiltinAgentMessageActions.OPEN_PREVIEW) {
    const url = getRequiredDataString(normalizedPayload, 'url', normalizedAction);
    if (typeof url !== 'string') {
      return url;
    }
    normalizedPayload.data = { ...normalizedPayload.data, url };
  }

  if (normalizedAction === BuiltinAgentMessageActions.OPEN_FILE) {
    const path = getRequiredDataString(normalizedPayload, 'path', normalizedAction);
    if (typeof path !== 'string') {
      return path;
    }
    normalizedPayload.data = { ...normalizedPayload.data, path };
  }

  return {
    type: AgentEventTypes.MESSAGE,
    action: normalizedAction,
    payload: normalizedPayload,
    meta: normalizeMeta(meta),
    timestamp: Date.now()
  };
}
