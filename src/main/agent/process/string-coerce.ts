/**
 * 字符串规整工具（仅保留 process 子系统内部需要的最小子集）
 *
 * 从 openclaw `src/shared/string-coerce.ts` 裁剪而来：
 * - normalizeOptionalString：trim 空串 → undefined
 * - normalizeLowercaseStringOrEmpty：trim + toLowerCase，空串回 ''
 *
 * 如果后续全局需要，可以再抽到 `src/main/common/` 下做统一。
 */

export function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function normalizeOptionalString(value: unknown): string | undefined {
  return normalizeNullableString(value) ?? undefined;
}

export function normalizeOptionalLowercaseString(value: unknown): string | undefined {
  return normalizeOptionalString(value)?.toLowerCase();
}

export function normalizeLowercaseStringOrEmpty(value: unknown): string {
  return normalizeOptionalLowercaseString(value) ?? '';
}
