<script setup lang="ts">
/**
 * ChatInput — 统一的对话输入框组件（基于 Tiptap）
 *
 * 支持富文本编辑、文件引用、Enter 发送等功能。
 */

import { watch, onUnmounted } from 'vue';
import { useEditor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { FileReference } from '../editor/extensions/FileReference';

export interface FileReferenceData {
  path: string;
  name: string;
}

const props = withDefaults(
  defineProps<{
    placeholder?: string;
    disabled?: boolean;
    showStopButton?: boolean;
  }>(),
  {
    placeholder: '输入消息... (Enter 发送，Shift+Enter 换行)',
    disabled: false,
    showStopButton: false
  }
);

const emit = defineEmits<{
  send: [data: { text: string; files: FileReferenceData[] }];
  stop: [];
}>();

// 创建 Tiptap 编辑器
const editor = useEditor({
  extensions: [
    StarterKit.configure({
      // 禁用默认的 Enter 行为，我们自己处理
      hardBreak: {
        keepMarks: true
      },
      // 禁用多余的标记（只需要纯文本和文件引用）
      bold: false,
      italic: false,
      strike: false,
      code: false,
      heading: false,
      bulletList: false,
      orderedList: false,
      blockquote: false,
      codeBlock: false,
      horizontalRule: false
    }),
    Placeholder.configure({
      placeholder: props.placeholder
    }),
    FileReference
  ],
  editorProps: {
    attributes: {
      class: 'tiptap-editor'
    }
  },
  autofocus: false,
  editable: !props.disabled
});

// 发送消息
function handleSend(): void {
  if (!editor.value || props.disabled) return;

  const text = editor.value.getText().trim();
  if (!text) return;

  // 提取文件引用
  const files: FileReferenceData[] = [];
  const json = editor.value.getJSON();

  // 遍历文档节点，提取文件引用
  interface TiptapNode {
    type?: string;
    content?: TiptapNode[];
    attrs?: Record<string, unknown>;
  }

  json.content?.forEach((node: TiptapNode) => {
    if (node.type === 'paragraph' && node.content) {
      node.content.forEach((child: TiptapNode) => {
        if (child.type === 'fileReference' && child.attrs) {
          files.push({
            path: child.attrs.path as string,
            name: child.attrs.name as string
          });
        }
      });
    }
  });

  emit('send', { text, files });

  // 清空编辑器
  editor.value.commands.clearContent();
  editor.value.commands.focus();
}

// 键盘事件处理
function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    handleSend();
  }
}

// 插入文件引用
function insertFileReference(file: FileReferenceData): void {
  if (!editor.value) return;

  editor.value
    .chain()
    .focus()
    .insertFileReference({
      path: file.path,
      name: file.name
    })
    .insertContent(' ')
    .run();
}

// 监听 disabled 状态变化
watch(
  () => props.disabled,
  (disabled) => {
    editor.value?.setEditable(!disabled);
  }
);

// 监听编辑器内容的键盘事件
let keydownCleanup: (() => void) | null = null;

watch(
  () => editor.value,
  (editorInstance) => {
    // 清理之前的事件监听
    if (keydownCleanup) {
      keydownCleanup();
      keydownCleanup = null;
    }

    if (editorInstance) {
      const el = editorInstance.view.dom;
      el.addEventListener('keydown', handleKeydown);

      keydownCleanup = () => {
        el.removeEventListener('keydown', handleKeydown);
      };
    }
  },
  { immediate: true }
);

onUnmounted(() => {
  if (keydownCleanup) {
    keydownCleanup();
  }
});

function setInputText(text: string): void {
  if (!editor.value) return;
  editor.value.commands.clearContent();
  editor.value.commands.insertContent(text);
  editor.value.commands.focus('end');
}

defineExpose({
  focus: () => editor.value?.commands.focus(),
  clear: () => editor.value?.commands.clearContent(),
  insertFileReference,
  setInputText
});

onUnmounted(() => {
  editor.value?.destroy();
});
</script>

<template>
  <div class="chat-input-wrapper">
    <EditorContent :editor="editor" class="chat-input" />

    <!-- 底部工具栏（内嵌在输入框内） -->
    <div class="chat-input-toolbar">
      <!-- 左侧：模型选择等（slot） -->
      <div class="toolbar-left">
        <slot name="toolbar-left" />
      </div>

      <!-- 右侧：操作按钮 -->
      <div class="toolbar-right">
        <!-- 停止按钮（流式时显示） -->
        <button v-if="showStopButton" class="toolbar-btn toolbar-btn-stop" title="中断" @click="emit('stop')">
          <span class="i-carbon-stop-filled inline-block h-3.5 w-3.5" />
        </button>
        <!-- 发送按钮（未流式时显示） -->
        <button
          v-else
          class="toolbar-btn toolbar-btn-send"
          title="发送 (Enter)"
          :disabled="disabled"
          @click="handleSend">
          <span class="i-carbon-arrow-up inline-block h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-input-wrapper {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 98px;
  border: 1px solid hsl(var(--border) / 0.45);
  border-radius: 10px;
  background: #ffffff;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease;
  /* 允许模型下拉等浮层向外展开，避免被卡片边界裁掉 */
  overflow: visible;
}

.chat-input-wrapper:focus-within {
  border-color: hsl(var(--primary) / 0.4);
  background: #ffffff;
}

/* 暗色模式适配 */
@media (prefers-color-scheme: dark) {
  .chat-input-wrapper {
    background: hsl(var(--surface) / 0.25);
    border-color: hsl(var(--border) / 0.35);
  }
}

.chat-input {
  flex: 1;
  min-height: 0;
  max-height: 220px;
  overflow-y: auto;
  padding: 11px 13px;
  padding-bottom: 44px;
}

.chat-input-toolbar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 10px;
  background: transparent;
  border-top: 1px solid hsl(var(--border) / 0.14);
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.toolbar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
  cursor: pointer;
  border: none;
  outline: none;
}

.toolbar-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.toolbar-btn-send {
  background: transparent;
  color: hsl(var(--primary));
}

.toolbar-btn-send:hover:not(:disabled) {
  background: hsl(var(--primary) / 0.1);
}

.toolbar-btn-stop {
  background: transparent;
  color: hsl(var(--error));
}

.toolbar-btn-stop:hover {
  background: hsl(var(--error) / 0.1);
}

/* Tiptap 编辑器样式 */
.chat-input :deep(.tiptap-editor) {
  width: 100%;
  min-height: 48px;
  color: hsl(var(--foreground));
  font-size: 14px;
  line-height: 1.55;
  outline: none;
}

.chat-input :deep(.tiptap-editor p) {
  margin: 0;
}

.chat-input :deep(.tiptap-editor p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  color: hsl(var(--muted-foreground) / 0.4);
  float: left;
  height: 0;
  pointer-events: none;
}

/* 文件引用样式 */
.chat-input :deep(.file-reference) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  margin: 0 2px;
  border-radius: 6px;
  background: hsl(var(--primary) / 0.1);
  border: 1px solid hsl(var(--primary) / 0.15);
  color: hsl(var(--primary));
  font-size: 11.5px;
  font-weight: 500;
  white-space: nowrap;
  user-select: all;
  transition: all 0.15s ease;
  cursor: pointer;
}

.chat-input :deep(.file-reference:hover) {
  background: hsl(var(--primary) / 0.15);
  border-color: hsl(var(--primary) / 0.25);
}

.chat-input :deep(.file-reference-icon) {
  font-size: 14px;
  line-height: 1;
}

.chat-input :deep(.file-reference-name) {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 编辑器禁用状态 */
.chat-input :deep(.tiptap-editor.ProseMirror-focused) {
  outline: none;
}

.chat-input :deep(.tiptap-editor[contenteditable='false']) {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
