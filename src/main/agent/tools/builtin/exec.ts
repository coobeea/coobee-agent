/**
 * exec — Shell 命令执行工具
 *
 * 在系统 shell 中执行命令，支持前台和后台两种模式。
 *
 * 前台模式（默认）：
 *   - 等待命令完成，返回 stdout/stderr 和退出码
 *   - 通过 AsyncGenerator 实时流式输出
 *   - 超时自动终止
 *
 * 后台模式（background: true）：
 *   - 立即返回 processId，进程在后台运行
 *   - 通过 process 工具管理（查看输出、发送输入、终止）
 *   - 适用于 dev server、watch 任务等长进程
 *
 * 安全：
 *   - 工作目录限制在 workspaceRoot 内
 *   - 支持 AbortSignal 取消
 *   - 超时自动终止（前台模式）
 *   - 命令安全策略（黑名单/白名单）由 HITL 审批层处理，工具层不参与安全判断
 *   - HITL 审批由上层 AgentExecutor 统一编排
 *
 * 分类：Execute | 风险：高（可执行任意系统命令）
 */
import { z } from 'zod';
import crypto from 'node:crypto';
import type { ToolDefinition, ToolStreamUpdate, ToolResult, ToolExecutionContext } from '../types';
import { ToolCategory } from '../types';
import { resolveWorkingDirectory } from '../../sandbox';

import { checkExecPolicy } from '../../sandbox/exec-policy';
import { scanCommand } from '../security/command-scanner';
import { getProcessSupervisor, getShellConfig, getBackgroundStore } from '../../process';
// import { getPtyManager } from '@main/terminal/PtyManager'; // 最小化模式下禁用

/** 默认超时（ms）— 2 分钟，覆盖大部分构建/测试场景 */
const DEFAULT_TIMEOUT_MS = 120_000;

/** 最大输出字节数（约 100KB，防止 token 爆炸） */
const MAX_OUTPUT_BYTES = 100_000;

export const execTool: ToolDefinition = {
  name: 'exec',
  description:
    'Execute a shell command. Supports two modes:\n' +
    '- Foreground (default): waits for completion, returns stdout/stderr/exit code.\n' +
    '- Background (background=true): starts the process in background, returns a processId immediately. ' +
    'Use the `process` tool to manage background processes (read output, send input, kill).\n' +
    'Use background mode for long-running tasks like dev servers, watchers, or builds.',
  category: ToolCategory.Execute,
  needUserConfirm: true,
  parameters: z.object({
    command: z.string().describe('The shell command to execute'),
    background: z
      .boolean()
      .optional()
      .describe('Run in background mode. Returns processId immediately. Use `process` tool to manage.'),
    terminal: z
      .boolean()
      .optional()
      .describe(
        'Run command in the interactive PTY terminal. ' +
          'Output is streamed to the user-visible terminal panel in real-time. ' +
          'Use for commands that benefit from real-time visual output (builds, tests, dev servers).'
      ),
    timeout: z
      .number()
      .optional()
      .describe(
        `Timeout in milliseconds (foreground only). Defaults to ${DEFAULT_TIMEOUT_MS / 1000}s. Set higher for builds/tests.`
      )
  }),

  execute: async function* (
    params: Record<string, unknown>,
    signal?: AbortSignal,
    context?: ToolExecutionContext
  ): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    const command = params.command as string;
    const background = params.background as boolean | undefined;
    const terminal = params.terminal as boolean | undefined;
    const timeout = (params.timeout as number) || DEFAULT_TIMEOUT_MS;
    const startTime = Date.now();

    if (!command || typeof command !== 'string') {
      return {
        success: false,
        llmContent: 'Error: command must be a non-empty string',
        error: { code: 'INVALID_PARAM', message: 'command must be a non-empty string' }
      };
    }

    // 工作目录：限制在 workspaceRoot 内
    const cwd = resolveWorkingDirectory(context);

    // 敏感路径和危险命令扫描（第一道防线）
    const scanError = scanCommand(command, cwd);
    if (scanError) {
      return {
        success: false,
        llmContent: `Error: ${scanError}`,
        error: { code: 'DANGEROUS_COMMAND', message: scanError }
      };
    }

    // 安全兜底：即使 Extension 未加载，黑名单/未知命令仍被拦截
    // Extension hook (tool-approval) 提供完整的 allow/ask/deny + HITL 逻辑，
    // 这里做 deny + ask（无审批能力时）的防线
    const policyResult = checkExecPolicy(command);
    if (policyResult.action === 'deny') {
      return {
        success: false,
        llmContent: `Error: ${policyResult.reason}`,
        error: { code: 'EXEC_POLICY_DENY', message: policyResult.reason }
      };
    }

    // 注意：审批逻辑已移至 ToolExecutionPipeline 统一处理
    // 如果到达这里，说明已经通过审批（或配置为 allow）
    // 即使 policyResult.action === 'ask'，也应该继续执行
    // （审批在 Pipeline 层完成，工具层只负责执行）

    // ==================== 终端模式 ====================
    if (terminal) {
      yield { type: 'progress', content: `[terminal] $ ${command}`, percentage: 0 };

      const termEnv = { ...process.env, ...context?.envVars };
      const supervisor = getProcessSupervisor();
      const sessionId = (context?.sessionId as string | undefined) ?? 'exec-tool';
      const backendId = 'exec-tool-terminal';

      let termStdout = '';
      let termStdoutBytes = 0;
      let termStdoutTruncated = false;

      let run: Awaited<ReturnType<typeof supervisor.spawn>> | undefined;
      const onAbort = (): void => {
        run?.cancel('manual-cancel');
      };
      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }
      try {
        run = await supervisor.spawn({
          mode: 'pty',
          sessionId,
          backendId,
          ptyCommand: command,
          cwd,
          env: termEnv,
          timeoutMs: timeout,
          captureOutput: false,
          onStdout: (chunk) => {
            if (termStdoutBytes < MAX_OUTPUT_BYTES) {
              const remain = MAX_OUTPUT_BYTES - termStdoutBytes;
              const bytes = Buffer.byteLength(chunk, 'utf-8');
              if (bytes <= remain) {
                termStdout += chunk;
                termStdoutBytes += bytes;
              } else {
                termStdout += Buffer.from(chunk, 'utf-8').subarray(0, remain).toString('utf-8');
                termStdoutBytes = MAX_OUTPUT_BYTES;
                termStdoutTruncated = true;
              }
            } else {
              termStdoutTruncated = true;
            }
          }
        });

        const exit = await run.wait();
        if (termStdoutTruncated) {
          termStdout += `\n... [output truncated at ${MAX_OUTPUT_BYTES} bytes]`;
        }

        const timedOut = exit.timedOut;
        const parts: string[] = [];
        if (timedOut) {
          parts.push(`[Timed out after ${timeout}ms]`);
        }
        parts.push(`Exit code: ${exit.exitCode ?? 'null (killed)'}`);
        if (termStdout.trim()) {
          parts.push(`output:\n${termStdout.trim()}`);
        }
        const llmContent = parts.join('\n\n');
        const success = exit.exitCode === 0 && !timedOut && exit.reason === 'exit';

        yield {
          type: 'output',
          content: `Terminal command ${success ? 'completed' : 'failed'} in ${exit.durationMs}ms`
        };

        return {
          success,
          llmContent,
          userContent: llmContent,
          error: success
            ? undefined
            : {
                code: timedOut ? 'TIMEOUT' : exit.reason === 'manual-cancel' ? 'ABORTED' : 'EXIT_CODE',
                message: timedOut
                  ? `Terminal command timed out after ${timeout}ms`
                  : exit.reason === 'manual-cancel'
                    ? 'Terminal command cancelled'
                    : `Exit code: ${exit.exitCode}`
              },
          metadata: {
            startTime,
            endTime: Date.now(),
            duration: exit.durationMs,
            exitCode: exit.exitCode,
            timedOut,
            cwd,
            runId: run.runId,
            terminationReason: exit.reason,
            mode: 'terminal'
          }
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const isPtyMissing = /node-pty|PTY support is unavailable|Cannot find module/i.test(message);
        const userMessage = isPtyMissing
          ? '[Terminal] @lydell/node-pty is not installed. Install it via `pnpm add @lydell/node-pty` or use foreground mode.'
          : `[Terminal] Error: ${message}`;
        return {
          success: false,
          llmContent: userMessage,
          error: { code: isPtyMissing ? 'PTY_UNAVAILABLE' : 'TERMINAL_ERROR', message },
          metadata: { startTime, endTime: Date.now(), duration: Date.now() - startTime, cwd, mode: 'terminal' }
        };
      } finally {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
      }
    }

    // ==================== 后台模式 ====================
    if (background) {
      yield { type: 'progress', content: `[background] $ ${command}`, percentage: 0 };

      const bgEnv = { ...process.env, ...context?.envVars };
      const { shell, args: shellArgs } = getShellConfig();
      const supervisor = getProcessSupervisor();
      const store = getBackgroundStore();
      const sessionId = (context?.sessionId as string | undefined) ?? 'exec-tool';
      const backendId = 'exec-tool-background';
      const runId = crypto.randomUUID();

      // 先 register，确保 onStdout/onStderr 回调能在 spawn 过程中的早期输出就找到 entry
      store.register({ runId, sessionId, backendId, command, cwd });

      try {
        const run = await supervisor.spawn({
          mode: 'child',
          runId,
          sessionId,
          backendId,
          scopeKey: sessionId,
          argv: [shell, ...shellArgs, command],
          cwd,
          env: bgEnv,
          captureOutput: false,
          stdinMode: 'pipe-open',
          onStdout: (chunk) => store.appendStdout(runId, chunk),
          onStderr: (chunk) => store.appendStderr(runId, chunk)
        });
        store.bindRun(runId, run);

        // 异步等待退出，落 store state
        void run
          .wait()
          .then((exit) => store.markExited(runId, exit))
          .catch(() =>
            store.markExited(runId, {
              reason: 'spawn-error',
              exitCode: null,
              exitSignal: null,
              durationMs: 0,
              stdout: '',
              stderr: '',
              timedOut: false,
              noOutputTimedOut: false
            })
          );

        const llmContent =
          `[Background] Process started.\n` +
          `processId: ${runId}\n` +
          `pid: ${run.pid ?? 'unknown'}\n` +
          `Use the \`process\` tool (action=read/write/kill, processId="${runId}") to manage it.`;

        yield { type: 'output', content: llmContent };

        return {
          success: true,
          llmContent,
          userContent: llmContent,
          metadata: {
            startTime,
            endTime: Date.now(),
            duration: Date.now() - startTime,
            background: true,
            cwd,
            runId,
            pid: run.pid,
            sessionId,
            mode: 'background'
          }
        };
      } catch (err) {
        store.remove(runId);
        const message = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          llmContent: `[Background] Error starting process: ${message}`,
          error: { code: 'BACKGROUND_SPAWN_ERROR', message },
          metadata: { startTime, endTime: Date.now(), duration: Date.now() - startTime, cwd, mode: 'background' }
        };
      }
    }

    // ==================== 前台模式 ====================
    yield { type: 'progress', content: `$ ${command}`, percentage: 0 };

    // 合并上下文环境变量（COOBEE_* 等），供 Skill 脚本读取配置
    const fgEnv = { ...process.env, ...context?.envVars };

    // 跨平台 shell：macOS/Linux → sh/bash/zsh -c，Windows → pwsh -Command
    const { shell, args: shellArgs } = getShellConfig();
    const supervisor = getProcessSupervisor();
    const sessionId = (context?.sessionId as string | undefined) ?? 'exec-tool';
    const backendId = 'exec-tool-foreground';

    // 自己做 100KB 截断，上报时在末尾追加提示，避免把大输出全积到 RunExit.stdout
    let stdoutStr = '';
    let stderrStr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;

    const result: ToolResult = await (async (): Promise<ToolResult> => {
      let run: Awaited<ReturnType<typeof supervisor.spawn>> | undefined;
      const onAbort = (): void => {
        run?.cancel('manual-cancel');
      };
      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }
      try {
        run = await supervisor.spawn({
          mode: 'child',
          sessionId,
          backendId,
          argv: [shell, ...shellArgs, command],
          cwd,
          env: fgEnv,
          timeoutMs: timeout,
          captureOutput: false,
          stdinMode: 'pipe-closed',
          onStdout: (chunk) => {
            if (stdoutBytes < MAX_OUTPUT_BYTES) {
              const remain = MAX_OUTPUT_BYTES - stdoutBytes;
              const bytes = Buffer.byteLength(chunk, 'utf-8');
              if (bytes <= remain) {
                stdoutStr += chunk;
                stdoutBytes += bytes;
              } else {
                stdoutStr += Buffer.from(chunk, 'utf-8').subarray(0, remain).toString('utf-8');
                stdoutBytes = MAX_OUTPUT_BYTES;
                stdoutTruncated = true;
              }
            } else {
              stdoutTruncated = true;
            }
          },
          onStderr: (chunk) => {
            if (stderrBytes < MAX_OUTPUT_BYTES) {
              const remain = MAX_OUTPUT_BYTES - stderrBytes;
              const bytes = Buffer.byteLength(chunk, 'utf-8');
              if (bytes <= remain) {
                stderrStr += chunk;
                stderrBytes += bytes;
              } else {
                stderrStr += Buffer.from(chunk, 'utf-8').subarray(0, remain).toString('utf-8');
                stderrBytes = MAX_OUTPUT_BYTES;
                stderrTruncated = true;
              }
            } else {
              stderrTruncated = true;
            }
          }
        });

        const exit = await run.wait();

        if (stdoutTruncated) {
          stdoutStr += `\n... [stdout truncated at ${MAX_OUTPUT_BYTES} bytes]`;
        }
        if (stderrTruncated) {
          stderrStr += `\n... [stderr truncated at ${MAX_OUTPUT_BYTES} bytes]`;
        }

        const timedOut = exit.timedOut;
        const parts: string[] = [];
        if (timedOut) {
          parts.push(`[Timed out after ${timeout}ms]`);
        }
        parts.push(`Exit code: ${exit.exitCode ?? 'null (killed)'}`);
        if (stdoutStr.trim()) {
          parts.push(`stdout:\n${stdoutStr.trim()}`);
        }
        if (stderrStr.trim()) {
          parts.push(`stderr:\n${stderrStr.trim()}`);
        }

        const llmContent = parts.join('\n\n');
        const success = exit.exitCode === 0 && !timedOut && exit.reason === 'exit';

        return {
          success,
          llmContent,
          userContent: llmContent,
          error: success
            ? undefined
            : {
                code: timedOut ? 'TIMEOUT' : exit.reason === 'manual-cancel' ? 'ABORTED' : 'EXIT_CODE',
                message: timedOut
                  ? `Command timed out after ${timeout}ms`
                  : exit.reason === 'manual-cancel'
                    ? 'Command cancelled'
                    : `Exit code: ${exit.exitCode}`
              },
          metadata: {
            startTime,
            endTime: Date.now(),
            duration: exit.durationMs,
            exitCode: exit.exitCode,
            timedOut,
            stdoutBytes,
            stderrBytes,
            cwd,
            runId: run.runId,
            terminationReason: exit.reason
          }
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          llmContent: `Error executing command: ${message}`,
          error: { code: 'EXEC_ERROR', message },
          metadata: { startTime, endTime: Date.now(), duration: Date.now() - startTime, cwd }
        };
      } finally {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
      }
    })();

    // 输出最终结果摘要
    const exitInfo = result.metadata?.exitCode === 0 ? 'completed' : `failed (exit ${result.metadata?.exitCode})`;
    yield {
      type: 'output',
      content: `Command ${exitInfo} in ${result.metadata?.duration}ms`
    };

    return result;
  }
};
