import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isLegacyPiMonoSessionFile,
  migrateLegacyPiMonoSessionFiles,
  resolvePiMonoSessionRoot
} from '../PiMonoSessionPaths';

describe('PiMonoSessionPaths', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pimono-session-paths-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('PiMono 会话文件统一收纳到 sessionDir/sessions 子目录', () => {
    expect(
      resolvePiMonoSessionRoot('/tmp/cwd', {
        sessionDir: tmpDir,
        workspaceRoot: tmpDir,
        sessionId: 'thread-1'
      })
    ).toBe(path.join(tmpDir, 'sessions'));
  });

  it('显式传入独立 sessionDir 时也收纳到 sessions 子目录', () => {
    const sessionDir = path.join(tmpDir, 'custom-sessions');

    expect(
      resolvePiMonoSessionRoot('/tmp/cwd', {
        sessionDir,
        workspaceRoot: tmpDir,
        sessionId: 'thread-1'
      })
    ).toBe(path.join(sessionDir, 'sessions'));
  });

  it('缺少 sessionDir 时直接报错，不再写入 .coobee-test', () => {
    expect(() =>
      resolvePiMonoSessionRoot('/tmp/cwd', {
        sessionDir: '',
        workspaceRoot: tmpDir,
        sessionId: 'thread-1'
      })
    ).toThrow('sessionDir is required');
  });

  it('只迁移 workspace 根目录下的旧 PiMono 会话文件', async () => {
    const sessionId = '307549385198301184';
    const sessionRoot = path.join(tmpDir, 'sessions');
    const legacyFile = `2026-04-28T16-11-36-860Z_${sessionId}.jsonl`;
    const otherSessionFile = '2026-04-28T16-11-36-860Z_other.jsonl';
    const logger = { info: vi.fn(), warn: vi.fn() };

    fs.writeFileSync(path.join(tmpDir, legacyFile), '{"type":"session"}\n');
    fs.writeFileSync(path.join(tmpDir, otherSessionFile), '{"type":"session"}\n');
    fs.writeFileSync(path.join(tmpDir, 'history.jsonl'), '{}\n');
    fs.writeFileSync(path.join(tmpDir, 'events.jsonl'), '{}\n');
    fs.writeFileSync(path.join(tmpDir, 'context.jsonl'), '{}\n');

    await migrateLegacyPiMonoSessionFiles(tmpDir, sessionRoot, sessionId, logger);

    expect(fs.existsSync(path.join(sessionRoot, legacyFile))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, legacyFile))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, otherSessionFile))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'history.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'events.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'context.jsonl'))).toBe(true);
  });
});

describe('isLegacyPiMonoSessionFile', () => {
  it('识别 PiMono 旧会话文件并排除 workspace 托管文件', () => {
    expect(isLegacyPiMonoSessionFile('2026-04-28T16-11-36-860Z_thread-1.jsonl', 'thread-1')).toBe(true);
    expect(isLegacyPiMonoSessionFile('history.jsonl', 'thread-1')).toBe(false);
    expect(isLegacyPiMonoSessionFile('events.jsonl', 'thread-1')).toBe(false);
    expect(isLegacyPiMonoSessionFile('context.jsonl', 'thread-1')).toBe(false);
  });
});
