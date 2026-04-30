import { describe, it, expect } from 'vitest';
import {
  normalizeNullableString,
  normalizeOptionalString,
  normalizeOptionalLowercaseString,
  normalizeLowercaseStringOrEmpty
} from '../string-coerce';

describe('string-coerce', () => {
  describe('normalizeNullableString', () => {
    it('返回 trim 后的字符串', () => {
      expect(normalizeNullableString('  abc  ')).toBe('abc');
    });
    it('空字符串、只有空白、非字符串 → null', () => {
      expect(normalizeNullableString('')).toBeNull();
      expect(normalizeNullableString('   ')).toBeNull();
      expect(normalizeNullableString(undefined)).toBeNull();
      expect(normalizeNullableString(null)).toBeNull();
      expect(normalizeNullableString(123)).toBeNull();
      expect(normalizeNullableString({ a: 1 })).toBeNull();
    });
  });

  describe('normalizeOptionalString', () => {
    it('非法值 → undefined，而不是 null', () => {
      expect(normalizeOptionalString('')).toBeUndefined();
      expect(normalizeOptionalString(undefined)).toBeUndefined();
      expect(normalizeOptionalString(null)).toBeUndefined();
    });
    it('有效字符串原样 trim 返回', () => {
      expect(normalizeOptionalString('hello')).toBe('hello');
      expect(normalizeOptionalString(' Hello ')).toBe('Hello');
    });
  });

  describe('normalizeOptionalLowercaseString', () => {
    it('trim + toLowerCase', () => {
      expect(normalizeOptionalLowercaseString(' HeLLo ')).toBe('hello');
    });
    it('空串 → undefined', () => {
      expect(normalizeOptionalLowercaseString('')).toBeUndefined();
      expect(normalizeOptionalLowercaseString('   ')).toBeUndefined();
    });
  });

  describe('normalizeLowercaseStringOrEmpty', () => {
    it('有效值 → 小写', () => {
      expect(normalizeLowercaseStringOrEmpty('NPM.CMD')).toBe('npm.cmd');
    });
    it('无效值 → 空字符串', () => {
      expect(normalizeLowercaseStringOrEmpty(undefined)).toBe('');
      expect(normalizeLowercaseStringOrEmpty(null)).toBe('');
      expect(normalizeLowercaseStringOrEmpty('')).toBe('');
    });
  });
});
