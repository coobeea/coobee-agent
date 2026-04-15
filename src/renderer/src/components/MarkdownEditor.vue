<script setup lang="ts">
/**
 * MarkdownEditor — 基于 Tiptap 的 Markdown 编辑器
 * 
 * 用于编辑智能体的人格文件（IDENTITY, SOUL, USER, NOTES, HEARTBEAT）
 */
import { watch, onUnmounted } from 'vue';
import { useEditor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    placeholder?: string;
    readonly?: boolean;
    minHeight?: string;
  }>(),
  {
    placeholder: '开始编写...',
    readonly: false,
    minHeight: '200px'
  }
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

// 创建 Tiptap 编辑器
const editor = useEditor({
  extensions: [
    StarterKit,
    Placeholder.configure({
      placeholder: props.placeholder
    })
  ],
  content: props.modelValue,
  editorProps: {
    attributes: {
      class: 'markdown-editor-content'
    }
  },
  editable: !props.readonly,
  onUpdate: ({ editor }) => {
    const text = editor.getText();
    // 发送更新事件
    emit('update:modelValue', text);
  }
});

// 监听外部值变化
watch(
  () => props.modelValue,
  (newValue) => {
    if (editor.value && editor.value.getText() !== newValue) {
      editor.value.commands.setContent(newValue);
    }
  }
);

// 监听 readonly 状态
watch(
  () => props.readonly,
  (readonly) => {
    editor.value?.setEditable(!readonly);
  }
);

onUnmounted(() => {
  editor.value?.destroy();
});

defineExpose({
  focus: () => editor.value?.commands.focus(),
  clear: () => editor.value?.commands.clearContent()
});
</script>

<template>
  <div class="markdown-editor" :style="{ minHeight: minHeight }">
    <EditorContent :editor="editor" />
  </div>
</template>

<style scoped>
.markdown-editor {
  width: 100%;
  border-radius: 8px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  overflow-y: auto;
  transition: border-color 0.15s ease;
}

.markdown-editor:focus-within {
  border-color: hsl(var(--primary));
  outline: none;
  box-shadow: 0 0 0 1px hsl(var(--primary) / 0.2);
}

/* 编辑器内容样式 */
.markdown-editor :deep(.markdown-editor-content) {
  padding: 12px 16px;
  min-height: inherit;
  color: hsl(var(--foreground));
  font-size: 14px;
  line-height: 1.7;
  outline: none;
  font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
}

.markdown-editor :deep(.markdown-editor-content p) {
  margin: 0.5em 0;
}

.markdown-editor :deep(.markdown-editor-content p:first-child) {
  margin-top: 0;
}

.markdown-editor :deep(.markdown-editor-content p:last-child) {
  margin-bottom: 0;
}

/* Placeholder 样式 */
.markdown-editor :deep(.markdown-editor-content p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  color: hsl(var(--muted-foreground) / 0.5);
  float: left;
  height: 0;
  pointer-events: none;
}

/* Markdown 样式 */
.markdown-editor :deep(.markdown-editor-content h1) {
  font-size: 1.8em;
  font-weight: 700;
  margin: 1em 0 0.5em;
  line-height: 1.3;
  color: hsl(var(--foreground));
}

.markdown-editor :deep(.markdown-editor-content h2) {
  font-size: 1.5em;
  font-weight: 600;
  margin: 0.8em 0 0.4em;
  line-height: 1.4;
  color: hsl(var(--foreground));
}

.markdown-editor :deep(.markdown-editor-content h3) {
  font-size: 1.2em;
  font-weight: 600;
  margin: 0.6em 0 0.3em;
  line-height: 1.4;
  color: hsl(var(--foreground));
}

.markdown-editor :deep(.markdown-editor-content ul),
.markdown-editor :deep(.markdown-editor-content ol) {
  padding-left: 1.5em;
  margin: 0.5em 0;
}

.markdown-editor :deep(.markdown-editor-content li) {
  margin: 0.2em 0;
}

.markdown-editor :deep(.markdown-editor-content code) {
  background: hsl(var(--muted));
  padding: 0.2em 0.4em;
  border-radius: 3px;
  font-size: 0.9em;
  font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
}

.markdown-editor :deep(.markdown-editor-content pre) {
  background: hsl(var(--muted));
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 0.8em 0;
}

.markdown-editor :deep(.markdown-editor-content pre code) {
  background: none;
  padding: 0;
}

.markdown-editor :deep(.markdown-editor-content blockquote) {
  border-left: 3px solid hsl(var(--primary));
  padding-left: 1em;
  margin: 0.8em 0;
  color: hsl(var(--muted-foreground));
  font-style: italic;
}

.markdown-editor :deep(.markdown-editor-content hr) {
  border: none;
  border-top: 1px solid hsl(var(--border));
  margin: 1.5em 0;
}

.markdown-editor :deep(.markdown-editor-content strong) {
  font-weight: 600;
  color: hsl(var(--foreground));
}

.markdown-editor :deep(.markdown-editor-content em) {
  font-style: italic;
  color: hsl(var(--muted-foreground));
}

/* 只读模式 */
.markdown-editor :deep(.markdown-editor-content[contenteditable='false']) {
  opacity: 0.7;
  cursor: not-allowed;
  background: hsl(var(--muted) / 0.3);
}
</style>
