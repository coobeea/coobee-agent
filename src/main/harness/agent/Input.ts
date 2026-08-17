/** 智能体单轮执行的请求级入参。 */
export interface AgentInput {
  requestId?: string;
  message: string;
  model?: string;
  provider?: string;
  thinkingLevel?: string;
  temperature?: number;
  instructions?: string;
  prependContext?: string;
  appendContext?: string;
  replaceSystemPrompt?: string;
  contextWindow?: number;
}
