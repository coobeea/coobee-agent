import path from 'node:path';
import { DirSubagents } from '../session/SessionStore';

/** Resolves child agent session directory under parent SessionRoot. */
export function childSessionRoot(parentSessionRoot: string, childSessionId: string): string {
  return path.join(parentSessionRoot, DirSubagents, childSessionId);
}
