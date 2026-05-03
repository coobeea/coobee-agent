import fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import type { AnalysisResult, InsightSession, SessionConfig } from '@shared/types/insight';
import { generateSnowflakeId } from '@main/utils/SnowflakeIdGenerator';
import {
  ensureDir,
  ensureSessionLayout,
  getInsightSessionsDir,
  getLatestResultPath,
  getSessionMetaPath,
  getTranscriptPath,
  readJsonFile,
  writeJsonFile
} from './storage';

export class SessionManager {
  async init(): Promise<void> {
    await ensureDir(getInsightSessionsDir());
  }

  async create(params: {
    templateId: string;
    templateName: string;
    config?: SessionConfig;
    initialText?: string;
    metadata?: Record<string, unknown>;
  }): Promise<InsightSession> {
    await this.init();

    const id = generateSnowflakeId();
    const now = Date.now();
    const transcript = params.initialText?.trim() ?? '';

    const session: InsightSession = {
      id,
      templateId: params.templateId,
      templateName: params.templateName,
      status: 'recording',
      startTime: now,
      updatedAt: now,
      transcript,
      snapshotCount: 0,
      config: params.config,
      metadata: params.metadata
    };

    await ensureSessionLayout(id);
    await writeJsonFile(getSessionMetaPath(id), session);
    await fsp.writeFile(getTranscriptPath(id), transcript, 'utf-8');

    return session;
  }

  async get(sessionId: string): Promise<InsightSession | null> {
    return readJsonFile<InsightSession>(getSessionMetaPath(sessionId));
  }

  async list(): Promise<InsightSession[]> {
    await this.init();
    const sessionsDir = getInsightSessionsDir();
    const entries = await fsp.readdir(sessionsDir, { withFileTypes: true });

    const sessions = await Promise.all(
      entries.filter((entry) => entry.isDirectory()).map((entry) => this.get(entry.name))
    );

    return sessions
      .filter((session): session is InsightSession => session !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async listActive(): Promise<InsightSession[]> {
    const sessions = await this.list();
    return sessions.filter((session) => session.status !== 'completed');
  }

  async appendText(sessionId: string, text: string): Promise<InsightSession> {
    const session = await this.require(sessionId);
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error('text is required and must be a non-empty string');
    }

    const nextTranscript = session.transcript ? `${session.transcript}\n${trimmed}` : trimmed;
    const updated: InsightSession = {
      ...session,
      transcript: nextTranscript,
      updatedAt: Date.now()
    };

    await this.persist(updated);
    await fsp.writeFile(getTranscriptPath(sessionId), nextTranscript, 'utf-8');
    return updated;
  }

  async appendTranscript(sessionId: string, text: string): Promise<InsightSession> {
    const session = await this.require(sessionId);
    if (!text) {
      throw new Error('text is required and must be a non-empty string');
    }

    const nextTranscript = `${session.transcript}${text}`;
    const updated: InsightSession = {
      ...session,
      transcript: nextTranscript,
      updatedAt: Date.now()
    };

    await this.persist(updated);
    await fsp.writeFile(getTranscriptPath(sessionId), nextTranscript, 'utf-8');
    return updated;
  }

  async updateStatus(sessionId: string, status: InsightSession['status']): Promise<InsightSession> {
    const session = await this.require(sessionId);
    const now = Date.now();
    const updated: InsightSession = {
      ...session,
      status,
      updatedAt: now,
      ...(status === 'completed' ? { endTime: now } : {})
    };
    await this.persist(updated);
    return updated;
  }

  async saveLatestResult(sessionId: string, result: AnalysisResult): Promise<InsightSession> {
    const session = await this.require(sessionId);
    const now = Date.now();
    const updated: InsightSession = {
      ...session,
      latestResult: result,
      snapshotCount: session.snapshotCount + 1,
      lastSnapshotAt: now,
      status: 'recording',
      updatedAt: now
    };

    await this.persist(updated);
    await writeJsonFile(getLatestResultPath(sessionId), result);
    return updated;
  }

  async persist(session: InsightSession): Promise<void> {
    await writeJsonFile(getSessionMetaPath(session.id), session);
  }

  async require(sessionId: string): Promise<InsightSession> {
    const session = await this.get(sessionId);
    if (!session) {
      throw new Error(`Insight session "${sessionId}" not found`);
    }
    return session;
  }

  async getTranscript(sessionId: string): Promise<string> {
    const filePath = getTranscriptPath(sessionId);
    if (!fs.existsSync(filePath)) {
      return '';
    }
    return fsp.readFile(filePath, 'utf-8');
  }

  async getLatestResult(sessionId: string): Promise<AnalysisResult | null> {
    return readJsonFile<AnalysisResult>(getLatestResultPath(sessionId));
  }
}
