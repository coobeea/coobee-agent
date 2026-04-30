import { describe, it, expect } from 'vitest';
import { createRunRegistry } from '../supervisor/registry';
import type { RunRecord } from '../supervisor/types';

function buildRecord(runId: string, overrides: Partial<RunRecord> = {}): RunRecord {
  const ts = Date.now();
  return {
    runId,
    sessionId: 'sess-1',
    backendId: 'backend-1',
    state: 'starting',
    startedAtMs: ts,
    lastOutputAtMs: ts,
    createdAtMs: ts,
    updatedAtMs: ts,
    ...overrides
  };
}

describe('run registry', () => {
  it('add / get 返回副本，不直接共享内部状态', () => {
    const reg = createRunRegistry();
    const r = buildRecord('a');
    reg.add(r);
    const got = reg.get('a');
    expect(got).toBeDefined();
    expect(got).not.toBe(r); // 不同引用
    expect(got?.runId).toBe('a');
    // 外部 mutate 不影响内部
    if (got) got.state = 'exited';
    expect(reg.get('a')?.state).toBe('starting');
  });

  it('get 不存在返回 undefined', () => {
    const reg = createRunRegistry();
    expect(reg.get('nope')).toBeUndefined();
  });

  it('list 返回所有记录', () => {
    const reg = createRunRegistry();
    reg.add(buildRecord('a'));
    reg.add(buildRecord('b'));
    const list = reg.list();
    expect(list.map((r) => r.runId).sort()).toEqual(['a', 'b']);
  });

  it('listByScope 按 scopeKey 过滤', () => {
    const reg = createRunRegistry();
    reg.add(buildRecord('a', { scopeKey: 'sess-1' }));
    reg.add(buildRecord('b', { scopeKey: 'sess-2' }));
    reg.add(buildRecord('c', { scopeKey: 'sess-1' }));
    reg.add(buildRecord('d')); // 无 scope
    expect(
      reg
        .listByScope('sess-1')
        .map((r) => r.runId)
        .sort()
    ).toEqual(['a', 'c']);
    expect(reg.listByScope('sess-2').map((r) => r.runId)).toEqual(['b']);
    expect(reg.listByScope('   ')).toEqual([]);
  });

  it('updateState 更新状态 + 补丁字段', () => {
    const reg = createRunRegistry();
    reg.add(buildRecord('a'));
    const next = reg.updateState('a', 'running', { pid: 123 });
    expect(next?.state).toBe('running');
    expect(next?.pid).toBe(123);
    // 再读一次确认入库
    expect(reg.get('a')?.state).toBe('running');
    expect(reg.get('a')?.pid).toBe(123);
  });

  it('updateState 不存在的 runId 返回 undefined', () => {
    const reg = createRunRegistry();
    expect(reg.updateState('nope', 'running')).toBeUndefined();
  });

  it('touchOutput 更新 lastOutputAtMs / updatedAtMs', async () => {
    const reg = createRunRegistry();
    reg.add(buildRecord('a', { lastOutputAtMs: 1 }));
    // 用微小 delay 保证时间戳推进
    await new Promise((r) => setTimeout(r, 5));
    reg.touchOutput('a');
    const got = reg.get('a');
    expect(got?.lastOutputAtMs).toBeGreaterThan(1);
  });

  it('finalize 切换到 exited 并记录 exit 信息', () => {
    const reg = createRunRegistry();
    reg.add(buildRecord('a', { state: 'running' }));
    const res = reg.finalize('a', { reason: 'exit', exitCode: 0, exitSignal: null });
    expect(res?.firstFinalize).toBe(true);
    expect(res?.record.state).toBe('exited');
    expect(res?.record.exitCode).toBe(0);
    expect(res?.record.terminationReason).toBe('exit');
  });

  it('finalize 已经 exited 的 runId 返回 firstFinalize=false', () => {
    const reg = createRunRegistry();
    reg.add(buildRecord('a'));
    reg.finalize('a', { reason: 'exit', exitCode: 0, exitSignal: null });
    const second = reg.finalize('a', { reason: 'exit', exitCode: 0, exitSignal: null });
    expect(second?.firstFinalize).toBe(false);
  });

  it('finalize 不会覆盖已有的 terminationReason', () => {
    const reg = createRunRegistry();
    reg.add(buildRecord('a'));
    reg.updateState('a', 'exiting', { terminationReason: 'manual-cancel' });
    const res = reg.finalize('a', { reason: 'exit', exitCode: 0, exitSignal: null });
    expect(res?.record.terminationReason).toBe('manual-cancel');
  });

  it('finalize 不存在的 runId 返回 null', () => {
    const reg = createRunRegistry();
    expect(reg.finalize('nope', { reason: 'exit', exitCode: 0, exitSignal: null })).toBeNull();
  });

  it('delete 移除记录', () => {
    const reg = createRunRegistry();
    reg.add(buildRecord('a'));
    reg.delete('a');
    expect(reg.get('a')).toBeUndefined();
  });

  it('finalize 超过 maxExitedRecords 时按 FIFO 丢弃最早 exited', () => {
    const reg = createRunRegistry({ maxExitedRecords: 2 });
    for (const id of ['a', 'b', 'c']) {
      reg.add(buildRecord(id));
      reg.finalize(id, { reason: 'exit', exitCode: 0, exitSignal: null });
    }
    const list = reg.list();
    // a 应该被 prune 掉，剩 b / c
    expect(list.map((r) => r.runId).sort()).toEqual(['b', 'c']);
  });

  it('prune 只移除 exited 记录，running 的保留', () => {
    const reg = createRunRegistry({ maxExitedRecords: 1 });
    reg.add(buildRecord('running-1', { state: 'running' }));
    reg.add(buildRecord('exited-1'));
    reg.finalize('exited-1', { reason: 'exit', exitCode: 0, exitSignal: null });
    reg.add(buildRecord('exited-2'));
    reg.finalize('exited-2', { reason: 'exit', exitCode: 0, exitSignal: null });
    const ids = reg
      .list()
      .map((r) => r.runId)
      .sort();
    expect(ids).toContain('running-1');
    expect(ids).toContain('exited-2');
    expect(ids).not.toContain('exited-1');
  });
});
