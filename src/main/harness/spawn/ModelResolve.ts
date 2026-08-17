export type { SubagentModelPolicy } from '../config/ConfigLoader';
import type { SubagentModelPolicy } from '../config/ConfigLoader';
import { resolveFlashModel } from '../model/ModelProvider';

export { resolveFlashModel } from '../model/ModelProvider';

export interface SubagentModelInput {
  mainModel: string;
  model: string;
  provider: string;
  flashOptimized: boolean;
}

function resolveEffectiveSubagentModel(mainModel: string, policy: SubagentModelPolicy): string {
  const configured = policy.subagentModel?.trim();
  if (configured) return configured;
  if (!mainModel.trim()) return '';
  if (policy.subagentFlashOptimization !== false) {
    return resolveFlashModel(mainModel);
  }
  return mainModel;
}

function isFlashOptimizationApplied(mainModel: string, resolved: string): boolean {
  return Boolean(resolved && mainModel && resolved !== mainModel && resolveFlashModel(mainModel) === resolved);
}

/** Derives child model from parent run model and harness policy. */
export function resolveSubagentModelInput(
  parentModel: string,
  parentProvider: string,
  policy: SubagentModelPolicy
): SubagentModelInput {
  const mainModel = parentModel.trim();
  const model = resolveEffectiveSubagentModel(mainModel, policy);
  return {
    mainModel,
    model,
    provider: parentProvider.trim(),
    flashOptimized: isFlashOptimizationApplied(mainModel, model)
  };
}
