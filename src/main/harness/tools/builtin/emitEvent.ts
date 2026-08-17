import { EventTypeCatalog } from '../../event/spec/EventType';
import type { ExecContext } from '../definition/Tool';
import type { StreamUpdate, ToolResult } from '../../types/ToolTypes';
import { ToolCategoryObservability, ToolName } from '../../types/ToolTypes';
import { createHandlerTool, type HandlerTool } from './HandlerTool';
import { emitEventParamsSchema } from './schemas';
import { EmitEventToolDescription } from './descriptions';
import { formatError, strParam, successResult } from './helpers';

async function emitEventHandler(
  ctx: ExecContext,
  params: Record<string, unknown>,
  _onUpdate?: (update: StreamUpdate) => void
): Promise<ToolResult> {
  const text = strParam(params, 'text').trim();
  if (!text) return formatError('INVALID_PARAM', 'text is required');

  const data =
    params.data && typeof params.data === 'object' && !Array.isArray(params.data)
      ? (params.data as Record<string, unknown>)
      : {};

  const timestamp = new Date().toISOString();
  const notifyData = {
    action: 'notify',
    payload: { text, data },
    meta: {
      sessionId: ctx.sessionId,
      timestamp
    }
  };

  if (ctx.emitStandardEvent) {
    await ctx.emitStandardEvent(EventTypeCatalog.AgentNotify, text, notifyData);
  }

  return successResult('Notification has been sent to the user interface.');
}

export function createEmitEventTool(): HandlerTool {
  return createHandlerTool(ToolName.EmitEvent, EmitEventToolDescription, ToolCategoryObservability, emitEventHandler, {
    parametersSchema: emitEventParamsSchema
  });
}
