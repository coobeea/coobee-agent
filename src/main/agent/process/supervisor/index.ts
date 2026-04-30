import { createProcessSupervisor } from './supervisor';
import type { ProcessSupervisor } from './types';

let singleton: ProcessSupervisor | null = null;

/**
 * 返回进程内单例 ProcessSupervisor。
 * 所有默认跨场景复用这一个实例；测试可直接 `createProcessSupervisor()` 造独立实例。
 */
export function getProcessSupervisor(): ProcessSupervisor {
  if (singleton) {
    return singleton;
  }
  singleton = createProcessSupervisor();
  return singleton;
}

export { createProcessSupervisor } from './supervisor';
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
} from './types';
