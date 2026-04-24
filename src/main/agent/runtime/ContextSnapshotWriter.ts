/**
 * Context Snapshot Writer — LLM 请求上下文快照写入器
 *
 * 每次 LLM 调用完成后，由 Runtime 层将输入上下文和输出结果追加写入 JSONL 文件。
 * 用于调试、Prompt 优化和成本分析。
 *
 * 写入位置：{workspace}/context.jsonl（追加式，扁平化结构）
 *
 * 架构位置：
 *   AgentExecutor（调度层）
 *     → injectEnv() 设置 contextDir = {workspace}
 *     → Builder.contextDir(dir) → 传入 Runtime options
 *   Runtime 层（实际写入）
 *     → stream()/run() 完成后调用 saveContextSnapshot()
 */

import fs from 'fs';
import path from 'path';
import { createLogger } from '@main/common/logger';
import type { AgentRuntimeOptions, ExecutionResult } from './types';

const log = createLogger('runtime:context-snapshot');

// ==================== 类型定义 ====================

/**
 * 完整的上下文快照
 */
export interface ContextSnapshot {
  /** 写入时间 */
  timestamp: string;
  /** 会话 ID */
  sessionId: string;
  /** Runtime 类型 */
  runtime: string;
  /** 配置快照（不含敏感信息） */
  config: {
    /** Agent 名称 */
    name: string;
    /** 模型名称 */
    model: string;
    /** 系统指令 */
    instructions: string;
    /** 追加指令片段 */
    appendInstructions?: string[];
    /** 技能列表（仅名称和描述） */
    skills?: Array<{ name: string; description: string }>;
    /** 工具列表（仅名称和描述） */
    tools?: Array<{ name: string; description: string }>;
  };
  /** 用户消息 */
  userMessage: string;
  /** LLM 输出 */
  output: string;
  /** API 错误信息（仅在出错时有值） */
  error?: string;
  /** 工具调用记录 */
  toolCalls?: Array<{
    toolName: string;
    arguments: Record<string, unknown>;
    result?: unknown;
  }>;
  /** 执行耗时（ms） */
  duration?: number;
  /** 原始 API 请求体（OpenAI Chat Completions 格式） */
  rawApiRequest?: {
    model: string;
    messages: Array<{ role: string; content: string | unknown }>;
    tools?: Array<unknown>;
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
    [key: string]: unknown;
  };
}

// ==================== 写入函数 ====================

/**
 * 将上下文快照追加写入 JSONL 文件
 *
 * 写入失败仅记录警告，不阻断主流程。
 *
 * @param contextDir 上下文快照目录（{workspace}，扁平化结构）
 * @param snapshot   上下文快照数据
 */
export async function writeContextSnapshot(contextDir: string, snapshot: ContextSnapshot): Promise<void> {
  try {
    // 确保目录存在（正常情况已由 getAgentWorkspaceDir 创建，这里做兜底）
    if (!fs.existsSync(contextDir)) {
      fs.mkdirSync(contextDir, { recursive: true });
    }

    const filepath = path.join(contextDir, 'context.jsonl');
    const line = JSON.stringify(snapshot) + '\n';

    await fs.promises.appendFile(filepath, line, 'utf-8');
    log.info(`Appended context snapshot to context.jsonl`);
  } catch (error) {
    // 写入失败不阻断执行
    log.warn(`Write failed:`, error);
  }
}

// ==================== 便捷函数 ====================

/**
 * Runtime 层的便捷快照写入
 *
 * 从 AgentRuntimeOptions + ExecutionResult 自动构建快照并写入。
 * 如果 options.contextDir 未设置，直接跳过（不报错）。
 *
 * @param options     Runtime 选项（含 contextDir）
 * @param runtimeType Runtime 类型标识（如 'openai'、'pimono'）
 * @param input       用户输入消息
 * @param result      执行结果
 * @param rawApiRequest 原始 API 请求体（可选）
 */
export async function saveContextSnapshot(
  options: AgentRuntimeOptions,
  runtimeType: string,
  input: string,
  result: ExecutionResult,
  rawApiRequest?: ContextSnapshot['rawApiRequest']
): Promise<void> {
  const contextDir = options.contextDir;
  if (!contextDir) return;

  const snapshot: ContextSnapshot = {
    timestamp: new Date().toISOString(),
    sessionId: options.sessionId || 'unknown',
    runtime: runtimeType,
    config: {
      name: options.name,
      model: options.model || 'unknown',
      instructions: options.instructions,
      appendInstructions: options.appendInstructions,
      skills: options.skills?.map((s) => ({ name: s.name, description: s.description })),
      tools: options.tools?.map((t) => ({ name: t.name, description: t.description }))
    },
    userMessage: input,
    output: result.output,
    ...(result.error ? { error: result.error } : {}),
    toolCalls: result.toolCalls,
    duration: result.duration,
    ...(rawApiRequest ? { rawApiRequest } : {})
  };

  await writeContextSnapshot(contextDir, snapshot);
}
