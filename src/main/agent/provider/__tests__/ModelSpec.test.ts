import { describe, expect, it } from 'vitest';
import { isLegacyModelGroupSpec, normalizeModelSpec } from '../ModelSpec';

describe('ModelSpec', () => {
  it('保留 provider/model 模型标识并清理空白', () => {
    expect(normalizeModelSpec('  ollama/gemma4:e4b  ')).toBe('ollama/gemma4:e4b');
  });

  it('将旧版模型组引用视为未选择模型', () => {
    expect(normalizeModelSpec('@group:default')).toBeUndefined();
    expect(normalizeModelSpec('@high-performance')).toBeUndefined();
    expect(isLegacyModelGroupSpec('@group:default')).toBe(true);
  });

  it('将空值视为未选择模型', () => {
    expect(normalizeModelSpec('   ')).toBeUndefined();
    expect(normalizeModelSpec(undefined)).toBeUndefined();
  });
});
