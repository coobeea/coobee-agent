/**
 * useAITextPolish
 *
 * “一句话润色”业务 preset composable。
 *
 * 职责：
 *   1. 根据原文、字段 label、placeholder、业务上下文构造 message 与 instructions；
 *   2. 把“只返回润色后的文本，不要解释，不要 Markdown”这类业务约束固化下来；
 *   3. 调用 `useThreadlessExecutor().run(...)`；
 *   4. 管理 `idle / pending / generating / success / error` 状态与防重复触发。
 *
 * 不做：
 *   - 不做 DOM 回填（由指令 / 调用方处理）；
 *   - 不做长按监听（由指令 / 调用方处理）；
 *   - 不直接调用 `useGateway` 或 HTTP，仅依赖 `useThreadlessExecutor`。
 */

import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { useThreadlessExecutor, type ThreadlessRuntimeType } from './useThreadlessExecutor';

/** 润色状态 */
export type PolishStatus = 'idle' | 'pending' | 'generating' | 'success' | 'error';

/** `polish()` 入参 */
export interface PolishOptions {
  /** Agent ID，默认 'app-copilot' */
  agentId?: string;
  /** 覆盖默认业务 instructions（一般无需传） */
  instructions?: string;
  /** 自定义 message 模板，支持 `{text} {label} {placeholder} {context}` 占位符 */
  promptTemplate?: string;
  /** Runtime 类型 */
  runtimeType?: ThreadlessRuntimeType;
  /** 覆盖 Agent 默认模型 */
  modelOverride?: string;
  /** 字段标签（用于让模型知道“这是什么字段”） */
  label?: string;
  /** 字段 placeholder（辅助说明字段用途） */
  placeholder?: string;
  /** 业务上下文（例如“智能体描述”“工单标题”） */
  context?: string;
  /** AbortSignal */
  signal?: AbortSignal;
}

/** 组合式 API 返回值 */
export interface AITextPolish {
  /** 当前状态（响应式） */
  status: Ref<PolishStatus>;
  /** 是否正在生成（响应式） */
  isGenerating: ComputedRef<boolean>;
  /** 最近一次润色结果 */
  result: Ref<string>;
  /** 最近一次错误信息 */
  error: Ref<string | null>;
  /** 触发润色；生成中再次调用将被忽略 */
  polish: (text: string, options?: PolishOptions) => Promise<string | null>;
  /** 重置状态为 idle，并清空 result/error */
  reset: () => void;
}

/** 默认业务 instructions（强约束，避免模型多嘴） */
const DEFAULT_INSTRUCTIONS = [
  '你是一个中文/英文文本润色助手。',
  '任务：对用户给出的原文进行一次润色，使其表达更自然、更书面、更准确。',
  '严格要求：',
  '1. 只输出润色后的最终文本，不要解释，不要前言，不要后记。',
  '2. 不要使用 Markdown、不要加引号、不要加代码块。',
  '3. 原文是什么语言就用什么语言输出，不要翻译。',
  '4. 保留原文的语义和意图，不要编造事实。',
  '5. 保留必要的换行结构，不要把多段文字合并成一段。'
].join('\n');

/** 默认 message 模板 */
const DEFAULT_TEMPLATE = [
  '请润色下面这段文本。',
  '字段标签：{label}',
  '字段说明：{placeholder}',
  '业务上下文：{context}',
  '',
  '原文：',
  '{text}'
].join('\n');

/**
 * 用模板变量替换生成最终 message。
 *
 * 未提供的变量会被替换为 `（无）` 以免让模型误判。
 */
function renderTemplate(template: string, vars: Record<string, string | undefined>): string {
  return template.replace(/\{(text|label|placeholder|context)\}/g, (_, key: string) => {
    const v = vars[key];
    if (v === undefined || v === null || v === '') return '（无）';
    return v;
  });
}

/**
 * 创建一个 AI 文本润色器。
 *
 * @example
 *   const { polish, status, result, isGenerating } = useAITextPolish();
 *   await polish('今天 天气 很 好', { label: '描述', context: '智能体编辑' });
 */
export function useAITextPolish(): AITextPolish {
  const executor = useThreadlessExecutor();

  const status = ref<PolishStatus>('idle');
  const result = ref<string>('');
  const error = ref<string | null>(null);
  const isGenerating = computed(() => status.value === 'pending' || status.value === 'generating');

  async function polish(text: string, options: PolishOptions = {}): Promise<string | null> {
    // 防重复触发：生成中忽略新请求
    if (isGenerating.value) {
      return null;
    }

    const raw = text?.trim();
    if (!raw) {
      status.value = 'error';
      error.value = '原文为空，无法润色';
      return null;
    }

    const template = options.promptTemplate ?? DEFAULT_TEMPLATE;
    const message = renderTemplate(template, {
      text: raw,
      label: options.label,
      placeholder: options.placeholder,
      context: options.context
    });

    status.value = 'pending';
    error.value = null;

    try {
      status.value = 'generating';
      const resp = await executor.run({
        message,
        agentId: options.agentId,
        instructions: options.instructions ?? DEFAULT_INSTRUCTIONS,
        runtimeType: options.runtimeType,
        modelOverride: options.modelOverride,
        signal: options.signal
      });

      const output = (resp.text ?? '').trim();
      result.value = output;
      status.value = 'success';
      return output;
    } catch (err) {
      status.value = 'error';
      error.value = err instanceof Error ? err.message : String(err);
      return null;
    }
  }

  function reset(): void {
    status.value = 'idle';
    result.value = '';
    error.value = null;
  }

  return {
    status,
    isGenerating,
    result,
    error,
    polish,
    reset
  };
}
