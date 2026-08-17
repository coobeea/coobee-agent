import type { Agent } from '../agent/Agent';
import type { Signal } from '../types/Signal';
import type { RunRequest } from './RunDeps';

export interface Orchestrator {
  run(signal: Signal, agent: Agent, request: RunRequest): Promise<string>;
}
