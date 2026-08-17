/**
 * Vessel-aligned TypeScript OOP Harness kernel.
 *
 * Build chain: Harness.create(options) → newRunner(config) → runner.run(signal)
 */
export * from './logger';
export * from './types';
export * from './event';
export * from './session';
export * from './tools';
export * from './extension';
export * from './agent';
export * from './orchestrate';
export * from './runner';
export * from './Harness';
export * from './prompt';
export * from './skill';

// Avoid star-export collisions across spawn / config / model
export {
  childSessionRoot,
  resolveSubagentDelegate,
  resolveSubagentModelInput,
  runInline,
  registerSpawn,
  SpawnSubagentTool,
  Register
} from './spawn';
export type { SubagentModelInput, InlineRequest, InlineResult } from './spawn';

export {
  loadConfig,
  loadAgentProfile,
  loadPolicyFlags,
  loadSubagentModelPolicy,
  loadToolkitSubagentRefs,
  resolveSharedSkillsRoot,
  resolveGenerationSettings,
  ConfigFileName
} from './config';
export type { ConfigDoc, LoadedConfig, SubagentModelPolicy, InstructionsAssembler, ConfigAgentProfile } from './config';

export { DefaultModelProvider, newDefaultProvider, resolveFlashModel } from './model';
export type { ModelProvider, BuildRequest } from './model';
