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
    class="prose prose-zinc prose-sm dark:prose-invert w-full max-w-none"
    v-html="renderedHtml"></div>
</template>

<style scoped>
/* 自定义 prose 样式微调 */
.prose :deep(p) {
  margin: 0.4rem 0;
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

.prose :deep(li) {
  margin: 0.18rem 0;
  display: list-item;
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
}

/* 代码块容器 */
.prose :deep(.markdown-code-block) {
  position: relative;
  margin: 0.55rem 0;
  border-radius: 0.5rem;
  background: hsl(var(--muted) / 0.24);
  overflow: hidden;
  border: 1px solid hsl(var(--border) / 0.7);
}

/* 代码块顶部工具栏 */
.prose :deep(.code-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.4rem 0.65rem;
  background: hsl(var(--muted) / 0.36);
  border-bottom: 1px solid hsl(var(--border) / 0.7);
  font-size: 0.7rem;
}

.prose :deep(.code-language) {
  font-family: var(--font-mono);
  color: hsl(var(--muted-foreground));
  text-transform: uppercase;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.prose :deep(.code-copy-btn) {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.2rem 0.45rem;
  background: transparent;
  border: 1px solid hsl(var(--border) / 0.7);
  border-radius: 0.25rem;
  color: hsl(var(--muted-foreground));
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.2s;
}

.prose :deep(.code-copy-btn:hover) {
  background: hsl(var(--accent));
  color: hsl(var(--accent-foreground));
  border-color: hsl(var(--accent));
}

.prose :deep(.code-copy-btn.copied) {
  background: hsl(var(--success));
  color: hsl(var(--success-foreground));
  border-color: hsl(var(--success));
}

.prose :deep(.code-copy-btn.copied .copy-text)::before {
  content: '已复制';
}

.prose :deep(.code-copy-btn:not(.copied) .copy-text)::before {
  content: '复制';
}

.prose :deep(.copy-icon) {
  display: inline-block;
  width: 0.875rem;
  height: 0.875rem;
}

/* 代码块内容区域 */
.prose :deep(.code-content) {
  margin: 0;
  overflow-x: auto;
}

.prose :deep(.code-content pre) {
  margin: 0 !important;
  padding: 0.75rem !important;
  background: transparent !important;
  border: none !important;
  overflow-x: auto;
}

.prose :deep(.code-content pre code) {
  font-family: var(--font-mono);
  font-size: 0.82rem;
  line-height: 1.55;
  background: transparent;
  padding: 0;
}

/* 链接样式 */
.prose :deep(a) {
  color: hsl(var(--primary));
  text-decoration: underline;
  text-underline-offset: 2px;
  transition: color 0.2s;
}

.prose :deep(a:hover) {
  color: hsl(var(--primary-hover));
}
</style>
