import type { StreamEvent } from '../types/StreamEvent';
import type { Identity } from './Identity';
import type { AgentInput } from './Input';
import type { Description } from './Description';

/**
 * 最小智能体单元推理契约。
 * 禁止写 messages/events JSONL、禁止直接调 Extension Hook。
 */
export interface Agent {
  identity(): Identity;
  describeRun(input: AgentInput): Promise<Description>;
  stream(input: AgentInput, desc: Description): AsyncIterable<StreamEvent>;
}
