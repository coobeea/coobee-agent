import type { Tool } from '../definition/Tool';
import type { SessionStore } from '../../session/SessionStore';
import { createEditTool } from './edit';
import { createEmitEventTool } from './emitEvent';
import { createExecTool } from './exec';
import { createGlobTool } from './glob';
import { createGrepTool } from './grep';
import { createProcessTool } from './process';
import { createReadTool } from './read';
import { createSearchTool } from './search';
import { createSkillFindTool } from './skillFind';
import { createTodosTool } from './todos';
import { createWriteTool } from './write';

/** Returns official builtin tools as unified Tool implementations. */
export function catalogTools(sessionStore: SessionStore): Tool[] {
  return [
    createReadTool(),
    createWriteTool(),
    createEditTool(),
    createExecTool(),
    createProcessTool(),
    createSearchTool(),
    createGrepTool(),
    createGlobTool(),
    createSkillFindTool(),
    createTodosTool(sessionStore),
    createEmitEventTool()
  ];
}
