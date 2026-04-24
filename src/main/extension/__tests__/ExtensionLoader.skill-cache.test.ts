import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExtensionLoader } from '../ExtensionLoader';
import { ExtensionRegistry } from '../ExtensionRegistry';
import { SkillManager } from '../../agent/skills/SkillManager';

vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }),
  log: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd()
  }
}));

describe('ExtensionLoader skill cache invalidation', () => {
  let tmpDir: string;
  let registry: ExtensionRegistry;
  let loader: ExtensionLoader;
  let invalidateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-loader-cache-'));
    registry = new ExtensionRegistry();
    loader = new ExtensionLoader(registry);
    SkillManager.resetCacheForTests();
    invalidateSpy = vi.spyOn(SkillManager, 'invalidateCache');
  });

  afterEach(() => {
    invalidateSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    SkillManager.resetCacheForTests();
  });

  it('load/unload extension 后主动失效 Skill 缓存', async () => {
    const extDir = createSkillExtension(tmpDir);

    await loader.load(extDir, 'user');

    expect(registry.getSkillDirs()).toHaveLength(1);
    expect(invalidateSpy).toHaveBeenCalledWith(extDir, { immediate: true });

    await loader.unload('skill-ext');

    expect(registry.getSkillDirs()).toHaveLength(0);
    expect(invalidateSpy).toHaveBeenCalledWith('skill-ext', { immediate: true });
  });
});

function createSkillExtension(root: string): string {
  const extDir = path.join(root, 'skill-ext');
  const skillsDir = path.join(extDir, 'skills', 'demo');
  fs.mkdirSync(skillsDir, { recursive: true });
  fs.writeFileSync(
    path.join(extDir, 'extension.json'),
    JSON.stringify({
      id: 'skill-ext',
      name: 'Skill Extension',
      version: '1.0.0',
      skills: 'skills'
    })
  );
  fs.writeFileSync(path.join(skillsDir, 'SKILL.md'), '---\nname: demo\ndescription: Demo\n---\n\n# Demo');
  return extDir;
}
