/**
 * Markdown 渲染工具
 * 使用 markdown-it + highlight.js 实现代码高亮
 */

import MarkdownIt from 'markdown-it';
import highlightPlugin from 'markdown-it-highlightjs';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';

// 配置 markdown-it
const md = new MarkdownIt({
  html: false, // 禁用 HTML 标签（安全考虑）
  linkify: true, // 自动将 URL 转为链接
  typographer: true, // 启用智能引号等排版优化
  breaks: true // 将换行符转换为 <br>
});

// 添加代码高亮插件
md.use(highlightPlugin, {
  inline: true,
  auto: true,
  hljs
});

// 自定义代码块渲染，添加复制按钮和语言标签
const defaultFenceRender = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const lang = token.info.trim() || 'text';
  const code = token.content;

  // 生成唯一 ID 用于复制功能
  const codeId = `code-${Math.random().toString(36).substring(2, 9)}`;

  // 使用默认渲染器生成高亮后的 HTML
  const defaultHtml = defaultFenceRender(tokens, idx, options, env, self);

  // 包装代码块，添加顶部工具栏
  return `
    <div class="markdown-code-block" data-language="${lang}">
      <div class="code-header">
        <span class="code-language">${lang}</span>
        <button class="code-copy-btn" data-code-id="${codeId}" title="复制代码">
          <span class="copy-icon i-carbon-copy"></span>
          <span class="copy-text">复制</span>
        </button>
      </div>
      <div class="code-content" id="${codeId}" data-code="${encodeURIComponent(code)}">
        ${defaultHtml}
      </div>
    </div>
  `;
};

// 自定义行内代码渲染
md.renderer.rules.code_inline = (tokens, idx) => {
  const token = tokens[idx];
  const code = token.content;
  return `<code class="inline-code">${md.utils.escapeHtml(code)}</code>`;
};

// 自定义链接渲染，添加 target="_blank"
const defaultLinkRender =
  md.renderer.rules.link_open ||
  function (tokens, idx, options, _env, self) {
    return self.renderToken(tokens, idx, options);
  };

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const aIndex = tokens[idx].attrIndex('target');
  if (aIndex < 0) {
    tokens[idx].attrPush(['target', '_blank']);
    tokens[idx].attrPush(['rel', 'noopener noreferrer']);
  }
  return defaultLinkRender(tokens, idx, options, env, self);
};

/**
 * 渲染 Markdown 为 HTML
 * @param markdown Markdown 文本
 * @returns 安全的 HTML 字符串
 */
export function renderMarkdown(markdown: string): string {
  if (!markdown || markdown.trim() === '') {
    return '';
  }

  try {
    const html = md.render(markdown);
    // 使用 DOMPurify 清理 HTML，防止 XSS 攻击
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [
        'p',
        'br',
        'strong',
        'em',
        'u',
        's',
        'code',
        'pre',
        'blockquote',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'ul',
        'ol',
        'li',
        'a',
        'img',
        'table',
        'thead',
        'tbody',
        'tr',
        'th',
        'td',
        'div',
        'span',
        'hr',
        'del',
        'ins',
        'sup',
        'sub'
      ],
      ALLOWED_ATTR: [
        'href',
        'target',
        'rel',
        'src',
        'alt',
        'title',
        'class',
        'id',
        'data-language',
        'data-code-id',
        'data-code'
      ]
    });
  } catch (error) {
    console.error('Markdown 渲染失败:', error);
    return `<p class="text-error">渲染失败</p>`;
  }
}

/**
 * 从代码块中提取纯文本代码
 * @param codeId 代码块 ID
 * @returns 解码后的代码文本
 */
export function getCodeFromElement(codeId: string): string {
  const element = document.getElementById(codeId);
  if (!element) return '';

  const encodedCode = element.getAttribute('data-code');
  if (!encodedCode) return '';

  try {
    return decodeURIComponent(encodedCode);
  } catch {
    return element.textContent || '';
  }
}
