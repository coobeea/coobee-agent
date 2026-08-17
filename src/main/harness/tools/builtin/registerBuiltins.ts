import type { ToolRegistry } from '../ToolRegistry';
import type { SessionStore } from '../../session/SessionStore';
import { catalogTools } from './catalog';

/** Registers official builtin tools into the registry (upsert by name). */
export async function registerBuiltins(registry: ToolRegistry, sessionStore: SessionStore): Promise<void> {
  for (const tool of catalogTools(sessionStore)) {
    await registry.register({ tool, extensionId: '' });
  }
}
