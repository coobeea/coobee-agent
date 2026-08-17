import type { SessionMetadata, SessionStore } from '../session/SessionStore';

export interface DelegateResolveResult {
  childSessionId: string;
  reused: boolean;
}

interface SubagentRecord {
  childSessionId: string;
  delegate?: string;
  subagentKey?: string;
}

function readSubagentRecords(meta: SessionMetadata | null): SubagentRecord[] {
  if (!meta || !Array.isArray(meta.subagents)) return [];
  const out: SubagentRecord[] = [];
  for (const raw of meta.subagents as Record<string, unknown>[]) {
    const childSessionId = String(raw.session_id ?? raw.id ?? '').trim();
    if (!childSessionId) continue;
    out.push({
      childSessionId,
      delegate: raw.delegate != null ? String(raw.delegate) : undefined,
      subagentKey: raw.subagent_key != null ? String(raw.subagent_key) : undefined
    });
  }
  return out;
}

function findSubagentByDelegate(
  meta: SessionMetadata | null,
  delegate: string,
  subagentKey: string
): SubagentRecord | undefined {
  const records = readSubagentRecords(meta);
  const key = subagentKey.trim();
  for (const rec of records) {
    if ((rec.delegate ?? '').trim() !== delegate.trim()) continue;
    if (key && rec.subagentKey && rec.subagentKey !== key) continue;
    return rec;
  }
  return undefined;
}

function createChildSessionId(parentSessionId: string): string {
  const suffix = String(Date.now() % 1_000_000).padStart(6, '0');
  if (parentSessionId.length <= 3) return `${parentSessionId}${suffix}`;
  return `${parentSessionId.slice(0, -3)}${suffix}`;
}

/** Picks or creates a child session for a delegate handle. */
export async function resolveSubagentDelegate(
  store: SessionStore,
  parentSessionId: string,
  delegate: string,
  subagentKey: string,
  reuse: boolean
): Promise<DelegateResolveResult> {
  const handle = delegate.trim();
  if (!handle) throw new Error('delegate is required');

  const meta = await store.readMetadata(parentSessionId);
  const existing = findSubagentByDelegate(meta, handle, subagentKey);

  if (reuse) {
    if (!existing) {
      throw new Error(
        `no child session found for delegate ${JSON.stringify(handle)}; set reuse=false to start a new delegation`
      );
    }
    return { childSessionId: existing.childSessionId, reused: true };
  }

  if (existing) {
    throw new Error(
      `delegate ${JSON.stringify(handle)} is already in use; set reuse=true to continue that child session or choose a new delegate`
    );
  }

  return { childSessionId: createChildSessionId(parentSessionId), reused: false };
}
