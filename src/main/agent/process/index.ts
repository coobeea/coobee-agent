/**
 * 进程子系统对外总入口
 *
 * 对外只暴露 supervisor 的单例 / 工厂 / 类型；低层工具（kill-tree / spawn-utils /
 * windows-command 等）按需 deep import 即可，不建议走 barrel 再导。
 */

export { createProcessSupervisor, getProcessSupervisor } from './supervisor/index';

export type {
  ManagedRun,
  ManagedRunStdin,
  ProcessSupervisor,
  RunExit,
  RunRecord,
  RunState,
  SpawnInput,
  SpawnMode,
  SpawnProcessAdapter,
  TerminationReason
} from './supervisor/index';

export { getShellConfig, resolveShellFromPath } from './shell-utils';

export { createBackgroundStore, getBackgroundStore, DEFAULT_MAX_OUTPUT_BYTES } from './background-store';
export type { BackgroundStore, BackgroundEntrySnapshot, BackgroundState, WaitResult } from './background-store';
