import type { AgentRuntimeOptions } from '../types';

export type { ThinkingLevel } from '../types';

/**
 * PiMono runtime 目前直接复用通用的 AgentRuntimeOptions。
 *
 * 单独保留这一层类型入口，是为了让 pimono 子目录内部和测试代码
 * 有稳定的本地 import 路径，后面如果需要补 PiMono 专属字段，也可以继续在这里扩展。
 */
export interface PiMonoAgentRuntimeOptions extends AgentRuntimeOptions {}
