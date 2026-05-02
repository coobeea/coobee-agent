<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import type { ContentBlock } from '@/types/chat';
import { renderMarkdown, getCodeFromElement } from '@/utils/markdown';

const props = defineProps<{
  block: ContentBlock & { type: 'text' };
}>();

// 渲染后的 HTML
const renderedHtml = computed(() => renderMarkdown(props.block.text));

// 复制状态管理
const copiedCodeId = ref<string | null>(null);
let copyTimeout: ReturnType<typeof setTimeout> | null = null;

// 代码块容器引用
const contentRef = ref<HTMLElement | null>(null);

// 处理复制按钮点击
function handleCopyClick(event: Event): void {
  const target = event.target as HTMLElement;
  const btn = target.closest('.code-copy-btn') as HTMLElement;
  if (!btn) return;

  const codeId = btn.getAttribute('data-code-id');
  if (!codeId) return;

  const code = getCodeFromElement(codeId);
  if (!code) return;

  // 复制到剪贴板
  navigator.clipboard
    .writeText(code)
    .then(() => {
      copiedCodeId.value = codeId;
      btn.classList.add('copied');

      // 2 秒后恢复
      if (copyTimeout) clearTimeout(copyTimeout);
      copyTimeout = setTimeout(() => {
        copiedCodeId.value = null;
        btn.classList.remove('copied');
      }, 2000);
    })
    .catch((err) => {
      console.error('复制失败:', err);
    });
}

// 监听复制按钮点击
onMounted(() => {
  const container = contentRef.value;
  if (container) {
    container.addEventListener('click', handleCopyClick);
  }
});

// 当内容更新时重新绑定事件（流式渲染场景）
watch(
  () => props.block.text,
  () => {
    nextTick(() => {
      // 确保新添加的复制按钮也能响应点击
      const container = contentRef.value;
      if (container) {
        container.removeEventListener('click', handleCopyClick);
        container.addEventListener('click', handleCopyClick);
      }
    });
  }
);

onBeforeUnmount(() => {
  const container = contentRef.value;
  if (container) {
    container.removeEventListener('click', handleCopyClick);
  }
  if (copyTimeout) clearTimeout(copyTimeout);
});
</script>

<template>
  <div
    ref="contentRef"
    class="assistant-markdown prose prose-zinc prose-sm dark:prose-invert w-full max-w-none"
    v-html="renderedHtml"></div>
</template>

<style scoped>
.assistant-markdown {
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: normal;
  hyphens: auto;
}

/* 自定义 prose 样式微调 */
.prose :deep(p) {
  margin: 0.4rem 0;
  text-align: start;
  overflow-wrap: anywhere;
  word-break: normal;
  hyphens: auto;
}

.prose :deep(li) {
  margin: 0.18rem 0;
  display: list-item;
  overflow-wrap: anywhere;
  word-break: normal;
  hyphens: auto;
}

.prose :deep(li > p) {
  text-align: start;
}

.prose :deep(p:first-child) {
  margin-top: 0;
}

.prose :deep(p:last-child) {
  margin-bottom: 0;
}

.prose :deep(h1),
.prose :deep(h2),
.prose :deep(h3),
.prose :deep(h4),
.prose :deep(h5),
.prose :deep(h6) {
  margin-top: 0.75rem;
  margin-bottom: 0.4rem;
  font-weight: 600;
}

.prose :deep(ul),
.prose :deep(ol) {
  margin: 0.4rem 0;
  padding-left: 1.25rem;
  list-style-position: outside;
}

.prose :deep(ul) {
  list-style-type: disc;
}

.prose :deep(ol) {
  list-style-type: decimal;
}

.prose :deep(ul ul) {
  list-style-type: circle;
}

.prose :deep(ul ul ul) {
  list-style-type: square;
}

.prose :deep(li p) {
  margin: 0;
}

.prose :deep(hr) {
  margin: 0.75rem 0;
  border-color: hsl(var(--border));
}

.prose :deep(blockquote) {
  margin: 0.45rem 0;
  padding-left: 0.75rem;
  border-left: 3px solid hsl(var(--border));
  color: hsl(var(--muted-foreground));
  font-style: italic;
}

.prose :deep(table) {
  margin: 0.45rem 0;
  border-collapse: collapse;
  width: 100%;
  text-align: left;
}

.prose :deep(table th),
.prose :deep(table td) {
  border: 1px solid hsl(var(--border));
  padding: 0.4rem;
}

.prose :deep(table th) {
  background: hsl(var(--muted) / 0.3);
  font-weight: 600;
}

/* 行内代码 */
.prose :deep(.inline-code) {
  background: hsl(var(--muted) / 0.5);
  color: hsl(var(--foreground));
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  font-size: 0.875em;
  font-family: var(--font-mono);
  overflow-wrap: anywhere;
  word-break: break-word;
}

/* 代码块容器 — 终端风格深色背景 */
.prose :deep(.markdown-code-block) {
  position: relative;
  margin: 0.55rem 0;
  border-radius: 0.5rem;
  background: #1e1e2e;
  overflow: hidden;
  border: 1px solid #313244;
  text-align: left;
}

/* 代码块顶部工具栏 — 紧凑一体 */
.prose :deep(.code-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.3rem 0.75rem;
  background: #181825;
  border-bottom: 1px solid #313244;
  font-size: 0.7rem;
  min-height: 1.75rem;
}

.prose :deep(.code-language) {
  font-family: var(--font-mono);
  color: #6c7086;
  text-transform: lowercase;
  font-weight: 500;
  font-size: 0.7rem;
  letter-spacing: 0.3px;
}

.prose :deep(.code-copy-btn) {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.15rem 0.4rem;
  background: transparent;
  border: none;
  border-radius: 0.2rem;
  color: #6c7086;
  font-size: 0.68rem;
  cursor: pointer;
  transition: all 0.15s;
}

.prose :deep(.code-copy-btn:hover) {
  background: #313244;
  color: #cdd6f4;
}

.prose :deep(.code-copy-btn.copied) {
  color: #a6e3a1;
}

.prose :deep(.code-copy-btn.copied .copy-text)::before {
  content: '已复制';
}

.prose :deep(.code-copy-btn:not(.copied) .copy-text)::before {
  content: '复制';
}

.prose :deep(.copy-icon) {
  display: inline-block;
  width: 0.8rem;
  height: 0.8rem;
}

/* 代码块内容区域 */
.prose :deep(.code-content) {
  margin: 0;
  overflow-x: auto;
}

.prose :deep(.code-content pre) {
  margin: 0 !important;
  padding: 0.75rem 1rem !important;
  background: transparent !important;
  border: none !important;
  overflow-x: auto;
  white-space: pre;
}

.prose :deep(.code-content pre code) {
  font-family: var(--font-mono);
  font-size: 0.82rem;
  line-height: 1.6;
  background: transparent;
  padding: 0;
  color: #cdd6f4;
}

/* 代码块内强制使用深色高亮（覆盖全局 hljs 变量） */
.prose :deep(.markdown-code-block) .hljs-keyword,
.prose :deep(.markdown-code-block) .hljs-selector-tag,
.prose :deep(.markdown-code-block) .hljs-literal,
.prose :deep(.markdown-code-block) .hljs-section,
.prose :deep(.markdown-code-block) .hljs-link {
  color: #89b4fa;
  font-weight: 600;
}

.prose :deep(.markdown-code-block) .hljs-string,
.prose :deep(.markdown-code-block) .hljs-addition {
  color: #a6e3a1;
}

.prose :deep(.markdown-code-block) .hljs-variable,
.prose :deep(.markdown-code-block) .hljs-template-variable,
.prose :deep(.markdown-code-block) .hljs-template-tag {
  color: #f5c2e7;
}

.prose :deep(.markdown-code-block) .hljs-built_in,
.prose :deep(.markdown-code-block) .hljs-type {
  color: #94e2d5;
}

.prose :deep(.markdown-code-block) .hljs-title,
.prose :deep(.markdown-code-block) .hljs-name,
.prose :deep(.markdown-code-block) .hljs-attribute,
.prose :deep(.markdown-code-block) .hljs-symbol,
.prose :deep(.markdown-code-block) .hljs-bullet {
  color: #f9e2af;
}

.prose :deep(.markdown-code-block) .hljs-number,
.prose :deep(.markdown-code-block) .hljs-regexp {
  color: #fab387;
}

.prose :deep(.markdown-code-block) .hljs-meta,
.prose :deep(.markdown-code-block) .hljs-meta .hljs-keyword,
.prose :deep(.markdown-code-block) .hljs-meta .hljs-string {
  color: #cba6f7;
}

.prose :deep(.markdown-code-block) .hljs-comment,
.prose :deep(.markdown-code-block) .hljs-quote {
  color: #6c7086;
  font-style: italic;
}

.prose :deep(.markdown-code-block) .hljs-function,
.prose :deep(.markdown-code-block) .hljs-class,
.prose :deep(.markdown-code-block) .hljs-title.function_,
.prose :deep(.markdown-code-block) .hljs-title.class_,
.prose :deep(.markdown-code-block) .hljs-title.class_.inherited__ {
  color: #89dceb;
  font-weight: 600;
}

.prose :deep(.markdown-code-block) .hljs-params,
.prose :deep(.markdown-code-block) .hljs-attr {
  color: #f5c2e7;
}

.prose :deep(.markdown-code-block) .hljs-tag {
  color: #cdd6f4;
}

.prose :deep(.markdown-code-block) .hljs-deletion {
  color: #f38ba8;
}

/* 链接样式 */
.prose :deep(a) {
  color: hsl(var(--primary));
  text-decoration: underline;
  text-underline-offset: 2px;
  transition: color 0.2s;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.prose :deep(a:hover) {
  color: hsl(var(--primary-hover));
}
</style>
