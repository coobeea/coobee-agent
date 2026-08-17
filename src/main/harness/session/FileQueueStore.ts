import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { SessionFile } from './SessionStore';

export interface QueueItem {
  id: string;
  payload: Record<string, unknown>;
  enqueued_at: string;
}

/**
 * 基于 queue.jsonl 的会话队列存储。
 */
export class FileQueueStore {
  constructor(private readonly sessionDir: string) {}

  private file(): string {
    return path.join(this.sessionDir, SessionFile.Queue);
  }

  async ensure(): Promise<void> {
    await mkdir(this.sessionDir, { recursive: true });
  }

  async list(): Promise<QueueItem[]> {
    try {
      await access(this.file());
    } catch {
      return [];
    }
    const raw = await readFile(this.file(), 'utf8');
    return raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l) as QueueItem);
  }

  async enqueue(payload: Record<string, unknown>, id?: string): Promise<QueueItem> {
    await this.ensure();
    const item: QueueItem = {
      id: id || `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      payload,
      enqueued_at: new Date().toISOString()
    };
    const list = await this.list();
    list.push(item);
    await this.persist(list);
    return item;
  }

  async peekHead(): Promise<QueueItem | null> {
    const list = await this.list();
    return list[0] ?? null;
  }

  async popHead(): Promise<QueueItem | null> {
    const list = await this.list();
    if (list.length === 0) return null;
    const [head, ...rest] = list;
    await this.persist(rest);
    return head;
  }

  async popIfHead(id: string): Promise<QueueItem | null> {
    const list = await this.list();
    if (list.length === 0 || list[0].id !== id) return null;
    const [head, ...rest] = list;
    await this.persist(rest);
    return head;
  }

  async isEmpty(): Promise<boolean> {
    return (await this.list()).length === 0;
  }

  async remove(id: string): Promise<boolean> {
    const list = await this.list();
    const next = list.filter((i) => i.id !== id);
    if (next.length === list.length) return false;
    await this.persist(next);
    return true;
  }

  async clear(): Promise<void> {
    await this.persist([]);
  }

  private async persist(list: QueueItem[]): Promise<void> {
    await this.ensure();
    const body = list.map((i) => JSON.stringify(i)).join('\n');
    await writeFile(this.file(), body ? `${body}\n` : '', 'utf8');
  }
}
