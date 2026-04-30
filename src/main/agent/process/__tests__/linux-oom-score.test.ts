import { describe, it, expect } from 'vitest';
import {
  CHILD_OOM_SCORE_ADJ_ENV_KEY,
  hardenedEnvForChildOomWrap,
  prepareOomScoreAdjustedSpawn,
  wrapArgvForChildOomScoreRaise
} from '../linux-oom-score';

const WRAP_SHELL = '/bin/sh';
const WRAP_SCRIPT = 'echo 1000 > /proc/self/oom_score_adj 2>/dev/null; exec "$0" "$@"';

describe('linux-oom-score', () => {
  describe('非 Linux 平台不 wrap', () => {
    it.each(['darwin', 'win32', 'freebsd'] as NodeJS.Platform[])('platform=%s 原样返回', (platform) => {
      const r = prepareOomScoreAdjustedSpawn('node', ['--version'], { platform, shellAvailable: () => true });
      expect(r.wrapped).toBe(false);
      expect(r.command).toBe('node');
      expect(r.args).toEqual(['--version']);
    });
  });

  describe('Linux 平台', () => {
    const linux: NodeJS.Platform = 'linux';

    it('默认启用 wrap：插入 /bin/sh -c 壳层', () => {
      const r = prepareOomScoreAdjustedSpawn('node', ['--version'], {
        platform: linux,
        env: {},
        shellAvailable: () => true
      });
      expect(r.wrapped).toBe(true);
      expect(r.command).toBe(WRAP_SHELL);
      expect(r.args).toEqual(['-c', WRAP_SCRIPT, 'node', '--version']);
    });

    it.each(['0', 'false', 'FALSE', 'No', 'off'])('env=%s 时禁用 wrap', (value) => {
      const r = prepareOomScoreAdjustedSpawn('node', ['--version'], {
        platform: linux,
        env: { [CHILD_OOM_SCORE_ADJ_ENV_KEY]: value },
        shellAvailable: () => true
      });
      expect(r.wrapped).toBe(false);
    });

    it('/bin/sh 不存在时也不 wrap', () => {
      const r = prepareOomScoreAdjustedSpawn('node', ['--version'], {
        platform: linux,
        env: {},
        shellAvailable: () => false
      });
      expect(r.wrapped).toBe(false);
    });

    it('命令以 - 开头不 wrap（避免被 sh exec 当作选项）', () => {
      const r = prepareOomScoreAdjustedSpawn('-weird', [], {
        platform: linux,
        env: {},
        shellAvailable: () => true
      });
      expect(r.wrapped).toBe(false);
      expect(r.command).toBe('-weird');
    });

    it('已经是 wrap 过的形式不重复 wrap', () => {
      const r = prepareOomScoreAdjustedSpawn(WRAP_SHELL, ['-c', WRAP_SCRIPT, 'node', '--version'], {
        platform: linux,
        env: {},
        shellAvailable: () => true
      });
      expect(r.wrapped).toBe(true);
      expect(r.command).toBe(WRAP_SHELL);
      expect(r.args).toEqual(['-c', WRAP_SCRIPT, 'node', '--version']);
    });

    it('wrap 时剥掉 BASH_ENV / ENV / CDPATH', () => {
      const r = prepareOomScoreAdjustedSpawn('node', [], {
        platform: linux,
        env: { PATH: '/usr/bin', BASH_ENV: '/tmp/init', ENV: '/tmp/env', CDPATH: '.' },
        shellAvailable: () => true
      });
      expect(r.wrapped).toBe(true);
      expect(r.env?.PATH).toBe('/usr/bin');
      expect(r.env?.BASH_ENV).toBeUndefined();
      expect(r.env?.ENV).toBeUndefined();
      expect(r.env?.CDPATH).toBeUndefined();
    });

    it('空命令不 wrap', () => {
      const r = prepareOomScoreAdjustedSpawn('', ['--version'], {
        platform: linux,
        env: {},
        shellAvailable: () => true
      });
      expect(r.wrapped).toBe(false);
    });
  });

  describe('wrapArgvForChildOomScoreRaise', () => {
    it('把 argv[0] + 剩余参数整体 wrap', () => {
      const out = wrapArgvForChildOomScoreRaise(['node', '--version'], {
        platform: 'linux',
        env: {},
        shellAvailable: () => true
      });
      expect(out).toEqual([WRAP_SHELL, '-c', WRAP_SCRIPT, 'node', '--version']);
    });

    it('空 argv 原样返回空数组', () => {
      expect(wrapArgvForChildOomScoreRaise([], { platform: 'linux', env: {}, shellAvailable: () => true })).toEqual([]);
    });

    it('非 Linux 原样返回', () => {
      expect(
        wrapArgvForChildOomScoreRaise(['node', '--version'], {
          platform: 'darwin',
          shellAvailable: () => true
        })
      ).toEqual(['node', '--version']);
    });
  });

  describe('hardenedEnvForChildOomWrap', () => {
    it('会被 wrap 时剥 shell-init env', () => {
      const out = hardenedEnvForChildOomWrap(
        { PATH: '/usr/bin', BASH_ENV: '/tmp/x' },
        { platform: 'linux', env: {}, shellAvailable: () => true }
      );
      expect(out?.PATH).toBe('/usr/bin');
      expect(out?.BASH_ENV).toBeUndefined();
    });

    it('非 Linux / opt-out / 无 sh 时原样返回', () => {
      const base = { PATH: '/usr/bin', BASH_ENV: '/tmp/x' };
      expect(
        hardenedEnvForChildOomWrap(base, {
          platform: 'darwin',
          shellAvailable: () => true
        })
      ).toBe(base);
      expect(
        hardenedEnvForChildOomWrap(base, {
          platform: 'linux',
          env: { [CHILD_OOM_SCORE_ADJ_ENV_KEY]: '0' },
          shellAvailable: () => true
        })
      ).toBe(base);
      expect(
        hardenedEnvForChildOomWrap(base, {
          platform: 'linux',
          env: {},
          shellAvailable: () => false
        })
      ).toBe(base);
    });
  });
});
