import type { ExecContext } from '../definition/Tool';
import type { StreamUpdate, ToolResult } from '../../types/ToolTypes';
import type { SessionStore, SessionTodoItem, SessionTodoList } from '../../session/SessionStore';
import { ToolCategoryObservability, ToolName } from '../../types/ToolTypes';
import { createHandlerTool, type HandlerTool } from './HandlerTool';
import { todosParamsSchema } from './schemas';
import { TodosToolDescription } from './descriptions';
import { formatError, optionalStr, strParam, successResult } from './helpers';

type TodoAction = 'read' | 'replace' | 'merge';

const STATUS_MARK: Record<string, string> = {
  pending: '[ ]',
  in_progress: '[~]',
  completed: '[x]',
  cancelled: '[-]'
};

function todoStats(items: SessionTodoItem[]): {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  cancelled: number;
} {
  const stats = { total: items.length, pending: 0, inProgress: 0, completed: 0, cancelled: 0 };
  for (const item of items) {
    switch (item.status) {
      case 'pending':
        stats.pending++;
        break;
      case 'in_progress':
        stats.inProgress++;
        break;
      case 'completed':
        stats.completed++;
        break;
      case 'cancelled':
        stats.cancelled++;
        break;
    }
  }
  return stats;
}

function formatTodoLLM(list: SessionTodoList, wrote: boolean): string {
  const stats = todoStats(list);
  const headline = wrote
    ? `TODO list updated (${stats.completed}/${stats.total} done)`
    : `Current TODO list (${stats.completed}/${stats.total} done)`;
  const lines = list.map((item) => {
    const mark = STATUS_MARK[item.status] ?? '[ ]';
    return `${mark} [${item.status}] ${item.content}`;
  });
  const detail = lines.length ? lines.join('\n') : '(empty)';
  return `${headline}.\n\nCurrent TODOs:\n${detail}\n\nStats: ${stats.pending} pending, ${stats.inProgress} in progress, ${stats.completed} completed, ${stats.cancelled} cancelled.`;
}

function parseTodoItems(params: Record<string, unknown>): Array<Record<string, unknown>> {
  const raw = params.todos;
  return Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
}

function applyTodoAction(
  action: TodoAction,
  current: SessionTodoList,
  patches: Array<Record<string, unknown>>,
  now: string
): { items?: SessionTodoList; error?: ToolResult } {
  if (action === 'replace') {
    const items: SessionTodoItem[] = [];
    for (const todo of patches) {
      const id = strParam(todo, 'id');
      const content = optionalStr(todo, 'content');
      const status = optionalStr(todo, 'status');
      if (!id) return { error: formatError('INVALID_PARAM', 'todo id is required') };
      if (!content) return { error: formatError('INVALID_PARAM', 'content is required when action is replace') };
      if (!status) return { error: formatError('INVALID_PARAM', 'status is required when action is replace') };
      items.push({ id, content, status, created_at: now, updated_at: now });
    }
    return { items };
  }

  const items = [...current];
  for (const todo of patches) {
    const id = strParam(todo, 'id');
    if (!id) return { error: formatError('INVALID_PARAM', 'todo id is required') };
    const idx = items.findIndex((item) => item.id === id);
    const content = optionalStr(todo, 'content');
    const status = optionalStr(todo, 'status');
    if (idx >= 0) {
      if (content) items[idx]!.content = content;
      if (status) items[idx]!.status = status;
      items[idx]!.updated_at = now;
      continue;
    }
    if (!content || !status) {
      return {
        error: formatError('INVALID_PARAM', 'new todo items require content and status when action is merge')
      };
    }
    items.push({ id, content, status, created_at: now, updated_at: now });
  }
  return { items };
}

function createTodosHandler(store: SessionStore) {
  return async function todosHandler(
    ctx: ExecContext,
    params: Record<string, unknown>,
    _onUpdate?: (update: StreamUpdate) => void
  ): Promise<ToolResult> {
    if (!store) return formatError('NO_SESSION_STORE', 'session storage is not configured for todos');

    const action = (strParam(params, 'action') || 'read') as TodoAction;
    let sessionId = ctx.sessionId;
    const sessionOverride = optionalStr(params, 'sessionId');
    if (sessionOverride) sessionId = sessionOverride;
    if (!sessionId) return formatError('MISSING_PARAM', 'session id is required');

    const pathCtx = {};

    switch (action) {
      case 'read': {
        try {
          const list = await store.readTodos(sessionId, pathCtx);
          return successResult(formatTodoLLM(list, false));
        } catch (err) {
          return formatError('READ_ERROR', err instanceof Error ? err.message : String(err));
        }
      }
      case 'replace':
      case 'merge': {
        const patches = parseTodoItems(params);
        if (!patches.length) {
          return formatError('MISSING_PARAM', 'todos array is required for replace and merge');
        }
        const now = new Date().toISOString();
        let current: SessionTodoList;
        try {
          current = await store.readTodos(sessionId, pathCtx);
        } catch (err) {
          return formatError('READ_ERROR', err instanceof Error ? err.message : String(err));
        }
        const applied = applyTodoAction(action, current, patches, now);
        if (applied.error) return applied.error;
        try {
          const list = await store.writeTodos(sessionId, applied.items!, pathCtx);
          return successResult(formatTodoLLM(list, true));
        } catch (err) {
          return formatError('WRITE_ERROR', err instanceof Error ? err.message : String(err));
        }
      }
      default:
        return formatError('INVALID_PARAM', `unknown action ${JSON.stringify(action)}`);
    }
  };
}

export function createTodosTool(store: SessionStore): HandlerTool {
  return createHandlerTool(ToolName.Todos, TodosToolDescription, ToolCategoryObservability, createTodosHandler(store), {
    parametersSchema: todosParamsSchema
  });
}
