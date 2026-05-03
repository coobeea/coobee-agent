import * as fsp from 'node:fs/promises';
import path from 'node:path';
import type { AnalysisResult, AnalysisSnapshot, DimensionChange } from '@shared/types/insight';
import { generateSnowflakeId } from '@main/utils/SnowflakeIdGenerator';
import { ensureDir, getSnapshotsDir, readJsonFile, writeJsonFile } from './storage';

export class SnapshotStore {
  async list(sessionId: string): Promise<AnalysisSnapshot[]> {
    const snapshotsDir = getSnapshotsDir(sessionId);
    await ensureDir(snapshotsDir);
    const files = (await fsp.readdir(snapshotsDir)).filter((file) => file.endsWith('.json')).sort();

    const snapshots = await Promise.all(
      files.map((file) => readJsonFile<AnalysisSnapshot>(path.join(snapshotsDir, file)))
    );

    return snapshots.filter((snapshot): snapshot is AnalysisSnapshot => snapshot !== null);
  }

  async create(params: {
    sessionId: string;
    trigger: AnalysisSnapshot['trigger'];
    transcript: string;
    newText: string;
    result: AnalysisResult;
    previousResult?: AnalysisResult;
    latencyMs: number;
    tokenUsage?: { prompt: number; completion: number };
  }): Promise<AnalysisSnapshot> {
    const existing = await this.list(params.sessionId);
    const sequence = existing.length + 1;
    const snapshot: AnalysisSnapshot = {
      id: generateSnowflakeId(),
      sessionId: params.sessionId,
      sequence,
      timestamp: Date.now(),
      trigger: params.trigger,
      transcriptRange: {
        start: Math.max(0, params.transcript.length - params.newText.length),
        end: params.transcript.length
      },
      fullTranscript: params.transcript,
      newText: params.newText,
      result: params.result,
      changes: buildChanges(params.previousResult, params.result),
      tokenUsage: params.tokenUsage,
      latencyMs: params.latencyMs
    };

    const filePath = path.join(getSnapshotsDir(params.sessionId), `${String(sequence).padStart(4, '0')}.json`);
    await writeJsonFile(filePath, snapshot);
    return snapshot;
  }
}

function buildChanges(previous: AnalysisResult | undefined, current: AnalysisResult): DimensionChange[] | undefined {
  if (!previous) {
    return undefined;
  }

  const changes: DimensionChange[] = [];

  for (const [key, dimension] of Object.entries(current.dimensions)) {
    const prevDimension = previous.dimensions[key];
    if (!prevDimension) {
      continue;
    }

    const previousValue = prevDimension.value;
    const currentValue = dimension.value;
    if (JSON.stringify(previousValue) === JSON.stringify(currentValue)) {
      continue;
    }

    changes.push({
      key,
      label: dimension.label,
      previousValue,
      currentValue,
      direction: deriveDirection(previousValue, currentValue)
    });
  }

  return changes.length > 0 ? changes : undefined;
}

function deriveDirection(previousValue: unknown, currentValue: unknown): DimensionChange['direction'] {
  if (typeof previousValue === 'number' && typeof currentValue === 'number') {
    if (currentValue > previousValue) return 'up';
    if (currentValue < previousValue) return 'down';
    return 'stable';
  }
  return 'changed';
}
