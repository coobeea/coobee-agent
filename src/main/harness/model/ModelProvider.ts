import type { Meta } from '../event/spec/Meta';

export interface BuildRequest {
  backend: string;
  baseURL: string;
  apiKey: string;
  identity?: Meta;
  modelName: string;
  provider?: string;
  thinkingLevel?: string;
}

/**
 * 模型提供者契约：构造后端客户端。
 */
export interface ModelProvider {
  buildClient(req: BuildRequest): Promise<unknown>;
}

/**
 * OpenAI-compatible 默认提供者。
 */
export class DefaultModelProvider implements ModelProvider {
  constructor(
    private readonly defaultBaseURL: string,
    private readonly defaultApiKey: string
  ) {}

  async buildClient(req: BuildRequest): Promise<unknown> {
    const baseURL = (req.baseURL || this.defaultBaseURL).trim();
    const apiKey = (req.apiKey || this.defaultApiKey).trim();
    if (!baseURL || !apiKey) {
      throw new Error('model: baseURL and apiKey are required');
    }
    const OpenAI = (await import('openai')).default;
    return new OpenAI({
      apiKey,
      baseURL
    });
  }
}

export function newDefaultProvider(baseURL: string, apiKey: string): ModelProvider {
  return new DefaultModelProvider(baseURL, apiKey);
}

const MAIN_MODEL_TO_FLASH: Record<string, string> = {
  'deepseek-v4-pro': 'deepseek-v4-flash',
  'mimo-v2.5-pro': 'mimo-v2.5'
};

export function resolveFlashModel(mainModel: string): string {
  const key = mainModel.trim();
  if (!key) return '';
  return MAIN_MODEL_TO_FLASH[key] ?? key;
}
