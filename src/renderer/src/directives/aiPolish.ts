/**
 * v-ai-polish 指令
 *
 * 让任意输入框通过指令获得 Ctrl/Control 长按润色能力。
 *
 * 使用：
 *   <textarea v-ai-polish />
 *   <textarea v-ai-polish="{ duration: 500, context: '智能体描述', label: '描述' }" />
 *   <input v-ai-polish="'请将下面的文本润色得更自然：{text}'" />
 *   <div contenteditable v-ai-polish />
 *
 * 触发条件：
 *   1. 目标元素已聚焦；
 *   2. 按下并保持 Ctrl / Control（Mac）超过 `duration`（默认 600ms）；
 *   3. 目标元素有非空文本。
 *
 * 触发后：
 *   - 浮层进入“生成中”；
 *   - 生成完成后回填值并派发 `input` + `change`；
 *   - 失败或取消则浮层短暂提示后隐藏。
 *
 * 注意：
 *   - 指令只依赖 useAITextPolish（preset 层），不直接依赖网络层；
 *   - 浮层使用原生 DOM，避免 Vue Teleport 在多实例下管理复杂度。
 */

import type { Directive, DirectiveBinding } from 'vue';
import { useAITextPolish, type PolishOptions } from '@/composables/useAITextPolish';

/** 指令绑定值 */
export type AIPolishBinding =
  | string // 作为 promptTemplate
  | false // 关闭（等同 disabled）
  | null
  | undefined
  | (PolishOptions & {
      /** 长按阈值 ms，默认 600 */
      duration?: number;
      /** 生成完成后是否自动回填，默认 true */
      autoApply?: boolean;
      /** 禁用指令（运行时可切换） */
      disabled?: boolean;
    });

/** 指令内部状态 */
interface PolishInstance {
  el: HTMLElement;
  options: Required<Pick<NonNullable<AIPolishBinding & object>, never>> & {
    duration: number;
    autoApply: boolean;
    disabled: boolean;
    polishOptions: PolishOptions;
  };
  pressTimer: ReturnType<typeof setTimeout> | null;
  isPressing: boolean;
  abortController: AbortController | null;
  indicator: Indicator;
  polisher: ReturnType<typeof useAITextPolish>;
  onKeyDown: (e: KeyboardEvent) => void;
  onKeyUp: (e: KeyboardEvent) => void;
  onBlur: () => void;
  onFocus: () => void;
}

/** 浮层 UI（轻量、原生 DOM） */
interface Indicator {
  show: (text: string, variant: IndicatorVariant) => void;
  hide: (delayMs?: number) => void;
  destroy: () => void;
}

type IndicatorVariant = 'hint' | 'loading' | 'success' | 'error';

const instances = new WeakMap<HTMLElement, PolishInstance>();

/** 判断是否 Ctrl/Control 键；Meta（Cmd）不触发以免与常用快捷键冲突 */
function isTriggerKey(e: KeyboardEvent): boolean {
  return e.key === 'Control';
}

/** 读取目标元素文本 */
function readText(el: HTMLElement): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value ?? '';
  }
  // contenteditable 或其他
  return el.innerText ?? el.textContent ?? '';
}

/** 写入目标元素文本并派发事件（让 v-model 生效） */
function writeText(el: HTMLElement, value: string): void {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    // 使用原生 setter，确保 Vue v-model 能捕获
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  // contenteditable
  el.innerText = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 创建一个浮层反馈 UI */
function createIndicator(anchor: HTMLElement): Indicator {
  const node = document.createElement('div');
  node.setAttribute('data-ai-polish-indicator', '');
  Object.assign(node.style, {
    position: 'fixed',
    zIndex: '99999',
    padding: '4px 10px',
    borderRadius: '6px',
    fontSize: '12px',
    lineHeight: '1.5',
    fontFamily: 'inherit',
    pointerEvents: 'none',
    opacity: '0',
    transform: 'translateY(-4px)',
    transition: 'opacity 120ms ease, transform 120ms ease',
    background: 'rgba(30, 30, 30, 0.92)',
    color: '#fff',
    boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
    display: 'none'
  } as CSSStyleDeclaration);
  document.body.appendChild(node);

  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  function position(): void {
    const rect = anchor.getBoundingClientRect();
    // 显示在输入框下方 4px，水平左对齐
    node.style.top = `${rect.bottom + 4}px`;
    node.style.left = `${rect.left}px`;
  }

  function variantStyle(variant: IndicatorVariant): void {
    switch (variant) {
      case 'hint':
        node.style.background = 'rgba(30, 30, 30, 0.92)';
        node.style.color = '#fff';
        break;
      case 'loading':
        node.style.background = '#2563eb';
        node.style.color = '#fff';
        break;
      case 'success':
        node.style.background = '#16a34a';
        node.style.color = '#fff';
        break;
      case 'error':
        node.style.background = '#dc2626';
        node.style.color = '#fff';
        break;
    }
  }

  function show(text: string, variant: IndicatorVariant): void {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    node.textContent = text;
    variantStyle(variant);
    node.style.display = 'block';
    position();
    // 触发一次回流以启用过渡
    void node.offsetWidth;
    node.style.opacity = '1';
    node.style.transform = 'translateY(0)';
  }

  function hide(delayMs = 0): void {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    const run = (): void => {
      node.style.opacity = '0';
      node.style.transform = 'translateY(-4px)';
      setTimeout(() => {
        node.style.display = 'none';
      }, 150);
    };
    if (delayMs > 0) {
      hideTimer = setTimeout(run, delayMs);
    } else {
      run();
    }
  }

  function destroy(): void {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    node.remove();
  }

  return { show, hide, destroy };
}

/** 解析绑定值为规范化参数 */
function normalizeBinding(raw: AIPolishBinding): {
  duration: number;
  autoApply: boolean;
  disabled: boolean;
  polishOptions: PolishOptions;
} {
  if (raw === false || raw === null || raw === undefined) {
    return { duration: 600, autoApply: true, disabled: raw === false, polishOptions: {} };
  }
  if (typeof raw === 'string') {
    return { duration: 600, autoApply: true, disabled: false, polishOptions: { promptTemplate: raw } };
  }
  const { duration, autoApply, disabled, ...polishOptions } = raw;
  return {
    duration: typeof duration === 'number' && duration > 0 ? duration : 600,
    autoApply: autoApply !== false,
    disabled: !!disabled,
    polishOptions
  };
}

/** 绑定指令到元素 */
function mount(el: HTMLElement, binding: DirectiveBinding<AIPolishBinding>): void {
  if (instances.has(el)) return;

  const normalized = normalizeBinding(binding.value);
  const indicator = createIndicator(el);
  const polisher = useAITextPolish();

  const instance: PolishInstance = {
    el,
    options: {
      duration: normalized.duration,
      autoApply: normalized.autoApply,
      disabled: normalized.disabled,
      polishOptions: normalized.polishOptions
    },
    pressTimer: null,
    isPressing: false,
    abortController: null,
    indicator,
    polisher,
    onKeyDown: () => {},
    onKeyUp: () => {},
    onBlur: () => {},
    onFocus: () => {}
  };

  const clearPressTimer = (): void => {
    if (instance.pressTimer) {
      clearTimeout(instance.pressTimer);
      instance.pressTimer = null;
    }
  };

  const trigger = async (): Promise<void> => {
    const text = readText(el);
    if (!text.trim()) {
      indicator.show('原文为空', 'error');
      indicator.hide(1500);
      return;
    }

    instance.abortController = new AbortController();
    indicator.show('正在润色…', 'loading');

    const polished = await instance.polisher.polish(text, {
      ...instance.options.polishOptions,
      signal: instance.abortController.signal
    });

    if (polished === null) {
      const err = instance.polisher.error.value;
      if (err) {
        indicator.show(`润色失败：${err}`, 'error');
        indicator.hide(2000);
      } else {
        // 被忽略（生成中），不提示
        indicator.hide();
      }
      return;
    }

    if (instance.options.autoApply) {
      writeText(el, polished);
    }
    indicator.show('已润色', 'success');
    indicator.hide(1200);
  };

  instance.onKeyDown = (e: KeyboardEvent): void => {
    if (instance.options.disabled) return;
    if (!isTriggerKey(e)) return;
    if (instance.isPressing) return;
    // 只在目标元素聚焦时生效
    if (document.activeElement !== el) return;
    instance.isPressing = true;
    indicator.show('继续按住 Ctrl 润色…', 'hint');
    clearPressTimer();
    instance.pressTimer = setTimeout(() => {
      instance.pressTimer = null;
      trigger().catch(() => {
        /* 已在 polisher 内归一错误 */
      });
    }, instance.options.duration);
  };

  instance.onKeyUp = (e: KeyboardEvent): void => {
    if (!isTriggerKey(e)) return;
    const wasPending = instance.pressTimer !== null;
    instance.isPressing = false;
    clearPressTimer();
    // 若在达到阈值前释放，直接隐藏 hint
    if (wasPending) {
      indicator.hide();
    }
  };

  instance.onBlur = (): void => {
    instance.isPressing = false;
    clearPressTimer();
    // 失焦同时中止未完成的生成，避免回填到已非聚焦字段
    if (instance.abortController) {
      instance.abortController.abort();
      instance.abortController = null;
    }
    indicator.hide();
  };

  instance.onFocus = (): void => {
    // 预留：聚焦时可提示 hotkey，这里保持静默
  };

  el.addEventListener('keydown', instance.onKeyDown);
  el.addEventListener('keyup', instance.onKeyUp);
  el.addEventListener('blur', instance.onBlur);
  el.addEventListener('focus', instance.onFocus);
  // 兜底：全局 keyup（如果在输入框外释放 Ctrl 也要清理）
  window.addEventListener('keyup', instance.onKeyUp);

  instances.set(el, instance);
}

/** 更新指令参数 */
function update(el: HTMLElement, binding: DirectiveBinding<AIPolishBinding>): void {
  const instance = instances.get(el);
  if (!instance) return;
  const normalized = normalizeBinding(binding.value);
  instance.options.duration = normalized.duration;
  instance.options.autoApply = normalized.autoApply;
  instance.options.disabled = normalized.disabled;
  instance.options.polishOptions = normalized.polishOptions;
}

/** 卸载指令 */
function unmount(el: HTMLElement): void {
  const instance = instances.get(el);
  if (!instance) return;
  if (instance.pressTimer) clearTimeout(instance.pressTimer);
  if (instance.abortController) instance.abortController.abort();
  el.removeEventListener('keydown', instance.onKeyDown);
  el.removeEventListener('keyup', instance.onKeyUp);
  el.removeEventListener('blur', instance.onBlur);
  el.removeEventListener('focus', instance.onFocus);
  window.removeEventListener('keyup', instance.onKeyUp);
  instance.indicator.destroy();
  instances.delete(el);
}

/** v-ai-polish 指令定义 */
export const aiPolish: Directive<HTMLElement, AIPolishBinding> = {
  mounted(el, binding) {
    mount(el, binding);
  },
  updated(el, binding) {
    update(el, binding);
  },
  beforeUnmount(el) {
    unmount(el);
  }
};
