export interface InstructionAssembly {
  effective: string;
  sources?: Record<string, string>;
}

export interface AgentProfile {
  agentId: string;
  name?: string;
  defaultModel?: string;
  defaultProvider?: string;
  instructionAssembly?: InstructionAssembly;
}

export interface GenerationSettings {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}

/** DescribeRun 返回值：本轮准备怎么跑。 */
export interface Description {
  profile: AgentProfile;
  selectedModel: string;
  provider: string;
  thinkingLevel: string;
  generation?: GenerationSettings;
  contextWindow: number;
  sessionMetadata?: Record<string, unknown> | null;
}
