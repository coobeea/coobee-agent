import * as fsp from 'node:fs/promises';
import type { AnalysisDimension, AnalysisTemplate, RefreshStrategy } from '@shared/types/insight';
import { generateSnowflakeId } from '@main/utils/SnowflakeIdGenerator';
import { builtinInsightTemplates } from './builtin-templates';
import { ensureDir, getInsightTemplatesDir, getTemplatePath, readJsonFile, writeJsonFile } from './storage';

export class TemplateStore {
  private readonly builtinTemplates: AnalysisTemplate[];

  constructor(templates: AnalysisTemplate[] = builtinInsightTemplates) {
    this.builtinTemplates = templates;
  }

  async list(): Promise<AnalysisTemplate[]> {
    const customTemplates = await this.listCustomTemplates();
    return [...this.builtinTemplates, ...customTemplates].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }

  async get(templateId: string): Promise<AnalysisTemplate | null> {
    const builtin = this.builtinTemplates.find((template) => template.id === templateId);
    if (builtin) {
      return builtin;
    }
    return readJsonFile<AnalysisTemplate>(getTemplatePath(templateId));
  }

  async create(params: {
    name: string;
    description: string;
    icon?: string;
    analysisPrompt?: string;
    refreshStrategy?: RefreshStrategy;
    dimensions: Array<{
      label: string;
      prompt: string;
      type?: AnalysisDimension['type'];
      options?: string[];
      maxItems?: number;
      showTrend?: boolean;
      required?: boolean;
    }>;
  }): Promise<AnalysisTemplate> {
    await ensureDir(getInsightTemplatesDir());

    const now = Date.now();
    const id = `custom-${generateSnowflakeId()}`;
    const dimensions = normalizeDimensions(params.dimensions);
    if (!dimensions.length) {
      throw new Error('自定义模板至少需要一个有效的分析模块');
    }
    const template: AnalysisTemplate = {
      id,
      name: params.name.trim(),
      description: params.description.trim(),
      icon: params.icon?.trim() || 'i-carbon-document-preliminary',
      category: 'custom',
      dimensions,
      analysisPrompt: buildAnalysisPrompt(params.analysisPrompt, dimensions),
      refreshStrategy: normalizeRefreshStrategy(params.refreshStrategy),
      outputFormat: 'card',
      builtIn: false,
      createdAt: now,
      updatedAt: now
    };

    await writeJsonFile(getTemplatePath(id), template);
    return template;
  }

  async update(
    templateId: string,
    params: {
      name: string;
      description: string;
      icon?: string;
      analysisPrompt?: string;
      refreshStrategy?: RefreshStrategy;
      dimensions: Array<{
        label: string;
        prompt: string;
        type?: AnalysisDimension['type'];
        options?: string[];
        maxItems?: number;
        showTrend?: boolean;
        required?: boolean;
      }>;
    }
  ): Promise<AnalysisTemplate> {
    const existing = await this.get(templateId);
    if (!existing) {
      throw new Error(`Insight template "${templateId}" not found`);
    }
    if (existing.builtIn) {
      throw new Error('内置模板不支持编辑');
    }

    const dimensions = normalizeDimensions(params.dimensions);
    if (!dimensions.length) {
      throw new Error('自定义模板至少需要一个有效的分析模块');
    }

    const updated: AnalysisTemplate = {
      ...existing,
      name: params.name.trim(),
      description: params.description.trim(),
      icon: params.icon?.trim() || existing.icon || 'i-carbon-document-preliminary',
      dimensions,
      analysisPrompt: buildAnalysisPrompt(params.analysisPrompt, dimensions),
      refreshStrategy: normalizeRefreshStrategy(params.refreshStrategy),
      updatedAt: Date.now()
    };

    await writeJsonFile(getTemplatePath(templateId), updated);
    return updated;
  }

  async delete(templateId: string): Promise<void> {
    const existing = await this.get(templateId);
    if (!existing) {
      throw new Error(`Insight template "${templateId}" not found`);
    }
    if (existing.builtIn) {
      throw new Error('内置模板不支持删除');
    }

    await fsp.unlink(getTemplatePath(templateId));
  }

  private async listCustomTemplates(): Promise<AnalysisTemplate[]> {
    await ensureDir(getInsightTemplatesDir());
    const templatesDir = getInsightTemplatesDir();
    const entries = await fsp.readdir(templatesDir, { withFileTypes: true });
    const templates = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => readJsonFile<AnalysisTemplate>(getTemplatePath(entry.name.replace(/\.json$/u, ''))))
    );
    return templates.filter((template): template is AnalysisTemplate => template !== null && !template.builtIn);
  }
}

function normalizeDimensions(
  dimensions: Array<{
    label: string;
    prompt: string;
    type?: AnalysisDimension['type'];
    options?: string[];
    maxItems?: number;
    showTrend?: boolean;
    required?: boolean;
  }>
): AnalysisDimension[] {
  const keys = new Set<string>();

  return dimensions
    .map((dimension, index) => {
      const label = dimension.label.trim();
      const prompt = dimension.prompt.trim();
      const baseKey = slugifyDimensionKey(label || `module-${index + 1}`);
      const key = ensureUniqueKey(baseKey, keys);
      const type = dimension.type ?? 'text';
      const options = type === 'enum' ? normalizeOptions(dimension.options) : undefined;

      return {
        key,
        label,
        prompt,
        type,
        options,
        maxItems: dimension.maxItems,
        showTrend: dimension.showTrend,
        required: dimension.required
      } satisfies AnalysisDimension;
    })
    .filter((dimension) => dimension.label && dimension.prompt);
}

function slugifyDimensionKey(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/giu, '-')
    .replace(/^-+|-+$/gu, '');
  return normalized || `module-${generateSnowflakeId()}`;
}

function ensureUniqueKey(baseKey: string, keys: Set<string>): string {
  let nextKey = baseKey;
  let counter = 2;
  while (keys.has(nextKey)) {
    nextKey = `${baseKey}-${counter}`;
    counter += 1;
  }
  keys.add(nextKey);
  return nextKey;
}

function normalizeOptions(options?: string[]): string[] | undefined {
  const normalized = (options ?? []).map((item) => item.trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}

function buildAnalysisPrompt(analysisPrompt: string | undefined, dimensions: AnalysisDimension[]): string {
  const prompt = analysisPrompt?.trim();
  if (prompt) {
    return prompt;
  }

  return [
    '请根据输入文本输出一份结构化洞察。',
    '请逐项完成以下分析模块，并确保每个模块都输出结果：',
    ...dimensions.map((dimension) => `- ${dimension.label}：${dimension.prompt}`)
  ].join('\n');
}

function normalizeRefreshStrategy(strategy?: RefreshStrategy): RefreshStrategy {
  return strategy ?? { trigger: 'manual' };
}
