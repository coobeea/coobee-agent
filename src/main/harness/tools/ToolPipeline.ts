import type { ToolResult } from '../types/ToolTypes';
import type { HookRunner } from '../extension/hook/HookRunner';
import { HookName } from '../extension/hook/HookName';
import type { ExecContext, Tool } from './definition/Tool';

/**
 * 工具执行管线：prepare_tool_call → handler → transform_tool_result。
 */
export class ToolPipeline {
  constructor(private readonly getHooks: () => HookRunner | null) {}

  async run(tool: Tool, ctx: ExecContext, params: Record<string, unknown>): Promise<ToolResult> {
    const hooks = this.getHooks();
    let effectiveParams = params;

    if (hooks) {
      const prep = await hooks.runModifying(HookName.PrepareToolCall, {
        tool_name: tool.descriptor().name,
        params: effectiveParams,
        tool_call_id: ctx.toolCallId
      });
      if (prep?.block) {
        return {
          success: false,
          error: {
            code: 'TOOL_BLOCKED',
            message: String(prep.reason ?? 'tool call blocked by hook')
          }
        };
      }
      if (prep?.params && typeof prep.params === 'object') {
        effectiveParams = prep.params as Record<string, unknown>;
      }
    }

    let result = await tool.execute(ctx, effectiveParams);

    if (hooks) {
      const transformed = await hooks.runModifying(HookName.TransformToolResult, {
        tool_name: tool.descriptor().name,
        result,
        tool_call_id: ctx.toolCallId
      });
      if (transformed?.result && typeof transformed.result === 'object') {
        result = transformed.result as ToolResult;
      }
      await hooks.runSoftVoid(HookName.ToolCallCompleted, {
        tool_name: tool.descriptor().name,
        success: result.success,
        tool_call_id: ctx.toolCallId
      });
    }

    return result;
  }
}
