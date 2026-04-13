/**
 * 工具执行管线 — 共享公共逻辑
 *
 * 将 OpenAI 和 PiMono 两个 Runtime 中重复的工具执行流程提取到此模块：
 *   1. before_tool_call Hook（审批 / 参数修改 / 拦截）
 *   2. sandbox toolPolicy 策略检查
 *   3. 执行工具 AsyncGenerator
 *   4. after_tool_call Hook + tool_result_persist Hook
 *
 * 各 Runtime 只需关注：
 *   - SDK 特有的 Tool 格式转换
 *   - 增量输出的桥接方式（StreamEmitter / onUpdate 回调）
 *
 * @module runtime/shared/ToolExecutionPipeline
 */

import path from 'node:path';
import os from 'node:os';
import { log } from '@main/common/logger';
import type { ToolDefinition, ToolExecutionContext, ToolResult, ToolStreamUpdate } from '../../tools/types';

// ==================== Types ====================

/** 管线执行结果 */
export interface PipelineResult {
  /** 最终文本结果（经过 hook 修改后） */
  resultText: string;
  /** 工具是否被拦截（before_tool_call block 或 policy deny） */
  blocked: boolean;
  /** 拦截原因 */
  blockReason?: string;
  /** 原始 ToolResult（未经 hook 修改） */
  rawResult?: ToolResult;
}

/** 增量输出回调 */
export type OnToolUpdate = (update: ToolStreamUpdate) => void;

/** 管线选项 */
export interface PipelineOptions {
  /** 工具执行上下文（沙箱 + Agent/Session 信息） */
  sandboxContext: ToolExecutionContext;
  /** 增量输出回调（由各 Runtime 桥接到 SDK 特定的机制） */
  onUpdate?: OnToolUpdate;
  /** AbortSignal（可选） */
  signal?: AbortSignal;
}

// ==================== Core ====================

/**
 * 执行工具核心流程（Phase 1.5 - 4）
 *
 * 包含：before_tool_call Hook、sandbox policy、execute、after_tool_call Hook
 *
 * @param def    - 工具定义
 * @param params - 工具参数
 * @param opts   - 管线选项
 * @returns 管线执行结果
 */
async function executeToolCore(
  def: ToolDefinition,
  params: Record<string, unknown>,
  opts: PipelineOptions
): Promise<PipelineResult> {
  let typedParams = params;
  const toolStartTime = Date.now();
  const sessionId = opts.sandboxContext.sessionId || '';

  // 📊 记录工具调用开始
  const paramsPreview = JSON.stringify(params).slice(0, 200);
  log.info(`[Tool] Start: tool=${def.name}, sessionId=${sessionId}, params=${paramsPreview}`);

  // === Phase 1.5: before_tool_call Hook (Extension 扩展点) ===
  try {
    const { ExtensionManager } = await import('../../../common/extension');
    const runner = ExtensionManager.getHookRunner();
    if (runner) {
      const hookResult = await runner.runModifyingHook('before_tool_call', {
        sessionId,
        toolName: def.name,
        params: typedParams,
        needUserConfirm: def.needUserConfirm ?? false
      });
      if (hookResult) {
        // Extension 可以 block 或修改参数
        if (hookResult.block) {
          // 📊 记录工具被 Hook 拦截
          const duration = Date.now() - toolStartTime;
          log.warn(
            `[Tool] Blocked by Hook: tool=${def.name}, sessionId=${sessionId}, duration=${duration}ms, reason=${hookResult.blockReason || 'no reason'}`
          );

          return {
            resultText: `Error: Tool blocked — ${hookResult.blockReason || 'no reason'}`,
            blocked: true,
            blockReason: hookResult.blockReason || 'no reason'
          };
        }
        if (hookResult.params) {
          typedParams = { ...typedParams, ...hookResult.params };
        }
        // suspend 逻辑已在 Phase 1 统一处理，Extension hook 不应返回 suspend
        if (hookResult.suspend) {
          log.warn(`[ToolPipeline] Extension returned suspend in Phase 1.5, ignoring (审批逻辑已在 Phase 1 处理)`);
        }
      }
    }
  } catch (error) {
    // before_tool_call Hook 失败不阻塞工具执行，但记录完整错误
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : undefined;
    log.error(
      `[ToolPipeline] before_tool_call hook failed for ${def.name}: ${errMsg}`,
      errStack ? { stack: errStack } : undefined
    );
  }

  // === Phase 2: sandbox toolPolicy 检查 ===
  try {
    const { isToolAllowed, formatToolBlockedMessage } = await import('../../sandbox');
    const toolPolicy = opts.sandboxContext.toolPolicy as import('../../sandbox/types').ResolvedToolPolicy | undefined;
    if (toolPolicy && !isToolAllowed(def.name, toolPolicy)) {
      const msg = formatToolBlockedMessage(def.name, toolPolicy);

      // 📊 记录工具被沙箱策略拦截
      const duration = Date.now() - toolStartTime;
      log.warn(
        `[Tool] Blocked by Policy: tool=${def.name}, sessionId=${sessionId}, duration=${duration}ms, reason=${msg}`
      );

      return {
        resultText: `Error: ${msg}`,
        blocked: true,
        blockReason: msg
      };
    }
  } catch (error) {
    // Sandbox 策略检查失败应阻止执行（安全优先）
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error(`[ToolPipeline] Sandbox policy check failed for ${def.name}: ${errMsg}`);
    return {
      resultText: `Error: Sandbox policy check failed — ${errMsg}`,
      blocked: true,
      blockReason: `Sandbox policy check error: ${errMsg}`
    };
  }

  // === Phase 3: 执行工具 ===
  let toolResult: ToolResult;
  try {
    const gen = def.execute(typedParams, opts.signal, opts.sandboxContext);
    let iterResult = await gen.next();

    // 消费 AsyncGenerator 的增量输出
    while (!iterResult.done) {
      const update = iterResult.value;
      if (opts.onUpdate) {
        opts.onUpdate(update);
      }
      iterResult = await gen.next();
    }

    // 最终结果 + 校验
    toolResult = iterResult.value;
  } catch (error) {
    // 📊 记录工具执行异常
    const duration = Date.now() - toolStartTime;
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error(`[Tool] Exception: tool=${def.name}, sessionId=${sessionId}, duration=${duration}ms, error=${errMsg}`);

    // 返回错误结果
    return {
      resultText: `Error: Tool execution failed — ${errMsg}`,
      blocked: false,
      rawResult: {
        success: false,
        error: { code: 'TOOL_EXCEPTION', message: errMsg }
      }
    };
  }

  // 校验 toolResult 结构
  if (!toolResult || typeof toolResult !== 'object') {
    const duration = Date.now() - toolStartTime;
    log.warn(
      `[Tool] Invalid Result: tool=${def.name}, sessionId=${sessionId}, duration=${duration}ms, reason=not an object`
    );
    return {
      resultText: 'Error: Tool returned invalid result structure',
      blocked: true,
      blockReason: 'Invalid tool result (not an object)'
    };
  }

  // 校验必需字段
  if (typeof toolResult.success !== 'boolean') {
    const duration = Date.now() - toolStartTime;
    log.warn(
      `[Tool] Invalid Result: tool=${def.name}, sessionId=${sessionId}, duration=${duration}ms, reason=missing success field`
    );
    return {
      resultText: 'Error: Tool result missing success field',
      blocked: true,
      blockReason: 'Invalid tool result (missing success field)'
    };
  }

  let resultText =
    toolResult.llmContent || (toolResult.success ? 'Success' : `Error: ${toolResult.error?.message || 'unknown'}`);

  // === Phase 4: after_tool_call + tool_result_persist Hooks ===
  try {
    const { ExtensionManager } = await import('../../../common/extension');
    const runner = ExtensionManager.getHookRunner();
    if (runner) {
      const toolDuration = Date.now() - toolStartTime;
      await runner.runVoidHook('after_tool_call', {
        sessionId,
        toolName: def.name,
        params: typedParams,
        result: resultText,
        durationMs: toolDuration
      });

      const persistResult = await runner.runModifyingHook('tool_result_persist', {
        sessionId,
        toolName: def.name,
        result: resultText
      });
      if (persistResult?.result) {
        resultText = persistResult.result;
      }
    }
  } catch (error) {
    // after_tool_call Hook 失败不影响工具结果返回，但记录完整错误
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : undefined;
    log.error(
      `[ToolPipeline] after_tool_call / tool_result_persist hook failed for ${def.name}: ${errMsg}`,
      errStack ? { stack: errStack } : undefined
    );
  }

  // 📊 记录工具调用完成
  const duration = Date.now() - toolStartTime;
  if (toolResult.success) {
    log.info(`[Tool] Success: tool=${def.name}, sessionId=${sessionId}, duration=${duration}ms`);
  } else {
    const errorMsg = toolResult.error?.message || 'unknown error';
    log.warn(`[Tool] Failed: tool=${def.name}, sessionId=${sessionId}, duration=${duration}ms, error=${errorMsg}`);
  }

  return {
    resultText,
    blocked: false,
    rawResult: toolResult
  };
}

/**
 * 执行工具的完整管线（入口）
 *
 * @param def    - 工具定义
 * @param params - 工具参数（来自 LLM）
 * @param opts   - 管线选项
 * @returns 管线执行结果
 */
export async function executeToolPipeline(
  def: ToolDefinition,
  params: Record<string, unknown>,
  opts: PipelineOptions
): Promise<PipelineResult> {
  const typedParams = params;

  // === Phase 1: ExecPolicy 检查（仅 exec 工具）===

  // 只有 exec 工具需要通过 ExecPolicy 检查
  if (def.name === 'exec' && params.command) {
    try {
      const { checkExecPolicy } = await import('../../sandbox/exec-policy');
      const policy = checkExecPolicy(params.command as string);

      // 黑名单命令直接拒绝
      if (policy.action === 'deny') {
        log.warn(`[ToolPipeline] ExecPolicy deny: "${String(params.command).slice(0, 50)}", reason=${policy.reason}`);
        return {
          resultText: `Error: Command rejected by security policy: ${policy.reason}`,
          blocked: true,
          blockReason: `Security policy: ${policy.reason}`
        };
      }

      // 未知命令直接拒绝（原 ask 操作，现改为拒绝以保证安全）
      if (policy.action === 'ask') {
        log.warn(`[ToolPipeline] ExecPolicy ask (rejected): "${String(params.command).slice(0, 50)}"`);
        return {
          resultText: `Error: Unknown command rejected for security. Command: ${String(params.command).slice(0, 100)}`,
          blocked: true,
          blockReason: 'Unknown command not in whitelist'
        };
      }

      // policy.action === 'allow' → 白名单命令，继续执行
      log.info(`[ToolPipeline] ExecPolicy allow: "${String(params.command).slice(0, 50)}"`);
    } catch (error) {
      log.warn(`[ToolPipeline] ExecPolicy check failed for ${def.name}:`, error);
      // 检查失败时拒绝执行（安全优先）
      return {
        resultText: `Error: Security check failed: ${error instanceof Error ? error.message : String(error)}`,
        blocked: true,
        blockReason: 'ExecPolicy check error'
      };
    }
  }

  // === Phase 1.5-4: 执行工具核心流程 ===
  return await executeToolCore(def, typedParams, opts);
}

/**
 * 创建最小化 ToolExecutionContext（Runtime 降级用）
 *
 * 当 AgentEnvInjector 未注入完整上下文时（如测试、直接调用），
 * 用合理的默认值填充所有必填字段。
 */
export function createFallbackToolContext(opts: { workspaceRoot: string; sessionId?: string }): ToolExecutionContext {
  const workspace = opts.workspaceRoot;
  const sessionId = opts.sessionId || 'unknown';
  const userHome = path.join(os.homedir(), '.coobee-ai');
  return {
    mode: 'path-only',
    workspaceRoot: workspace,
    toolPolicy: { allow: [], deny: [], confirm: [] },
    sessionId,
    threadId: sessionId,
    cwd: workspace,
    tasksDir: path.join(workspace, 'tasks'),
    sessionsDir: path.join(workspace, '.runtime', 'sessions'),
    contextsDir: path.join(workspace, '.runtime', 'contexts'),
    eventsDir: path.join(workspace, '.runtime', 'events'),
    userHome,
    configDir: path.join(userHome, 'config'),
    tempDir: os.tmpdir(),
    agentName: 'agent',
    agentMode: 'agent'
  };
}

