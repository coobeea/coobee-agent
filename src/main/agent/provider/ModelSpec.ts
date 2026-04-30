/**
 * 模型标识归一化。
 *
 * 当前运行链路只接受 provider/model 形式；旧版本的模型组引用（如 @group:default）
 * 已不再作为 Agent 持久化配置使用，进入执行层时应视为“未选择模型”。
 */
export function normalizeModelSpec(model?: string | null): string | undefined {
  if (typeof model !== 'string') {
    return undefined;
  }

  const normalized = model.trim();
  if (!normalized || isLegacyModelGroupSpec(normalized)) {
    return undefined;
  }

  return normalized;
}

export function isLegacyModelGroupSpec(model?: string | null): boolean {
  if (typeof model !== 'string') {
    return false;
  }

  const normalized = model.trim();
  return normalized.startsWith('@');
}
