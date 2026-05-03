import fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import { Env } from '@main/common/env';

const INSIGHT_ROOT_DIRNAME = 'insight';
const SESSIONS_DIRNAME = 'sessions';
const TEMPLATES_DIRNAME = 'templates';

export function getInsightRootDir(): string {
  return path.join(Env.paths.userHome, INSIGHT_ROOT_DIRNAME);
}

export function getInsightSessionsDir(): string {
  return path.join(getInsightRootDir(), SESSIONS_DIRNAME);
}

export function getInsightTemplatesDir(): string {
  return path.join(getInsightRootDir(), TEMPLATES_DIRNAME);
}

export function getTemplatePath(templateId: string): string {
  return path.join(getInsightTemplatesDir(), `${templateId}.json`);
}

export function getSessionDir(sessionId: string): string {
  return path.join(getInsightSessionsDir(), sessionId);
}

export function getSessionMetaPath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), 'session.json');
}

export function getTranscriptPath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), 'transcript.txt');
}

export function getLatestResultPath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), 'latest-result.json');
}

export function getSnapshotsDir(sessionId: string): string {
  return path.join(getSessionDir(sessionId), 'snapshots');
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fsp.mkdir(dirPath, { recursive: true });
}

export async function ensureSessionLayout(sessionId: string): Promise<void> {
  await ensureDir(getSnapshotsDir(sessionId));
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp`;
  await fsp.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  await fsp.rename(tempPath, filePath);
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const raw = await fsp.readFile(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}
