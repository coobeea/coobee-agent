<script setup lang="ts">
/**
 * MarkdownEditor — 基于 CodeMirror 6 的 Markdown 编辑器
 *
 * 用于编辑智能体的人格文件（IDENTITY, SOUL, USER, NOTES, HEARTBEAT, AGENTS）
 */
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, placeholder as placeholderExtension } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    placeholder?: string;
    readonly?: boolean;
    minHeight?: string;
  }>(),
  {
    placeholder: '开始编写 Markdown...',
    readonly: false,
    minHeight: '200px'
  }
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const editorContainer = ref<HTMLElement | null>(null);
let editorView: EditorView | null = null;
let isUpdatingFromProps = false;

// 使用 Compartment 来管理可编辑状态，以便动态更新
const editableCompartment = new Compartment();

onMounted(async () => {
  await nextTick();

  if (!editorContainer.value) return;

  // 配置 CodeMirror 扩展
  const extensions = [
    markdown(),
    oneDark,
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    editableCompartment.of(EditorView.editable.of(!props.readonly)),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !isUpdatingFromProps) {
        const newValue = update.state.doc.toString();
        emit('update:modelValue', newValue);
      }
    })
  ];

  // 如果有 placeholder，添加扩展
  if (props.placeholder) {
    extensions.push(placeholderExtension(props.placeholder));
  }

  // 创建编辑器状态
  const startState = EditorState.create({
    doc: props.modelValue,
    extensions
  });

  // 创建编辑器视图
  editorView = new EditorView({
    state: startState,
    parent: editorContainer.value
  });
});

// 监听外部值变化
watch(
  () => props.modelValue,
  (newValue) => {
    if (!editorView || isUpdatingFromProps) return;

    const currentValue = editorView.state.doc.toString();
    if (currentValue !== newValue) {
      isUpdatingFromProps = true;
      editorView.dispatch({
        changes: {
          from: 0,
          to: editorView.state.doc.length,
          insert: newValue
        }
      });
      isUpdatingFromProps = false;
    }
  }
);

// 监听 readonly 状态
watch(
  () => props.readonly,
  (readonly) => {
    if (!editorView) return;
    editorView.dispatch({
      effects: editableCompartment.reconfigure(EditorView.editable.of(!readonly))
    });
  }
);

onUnmounted(() => {
  if (editorView) {
    editorView.destroy();
    editorView = null;
  }
});

defineExpose({
  focus: () => editorView?.focus(),
  clear: () => {
    if (!editorView) return;
    editorView.dispatch({
      changes: { from: 0, to: editorView.state.doc.length, insert: '' }
    });
  }
});
</script>

<template>
  <div class="markdown-editor" :style="{ minHeight: minHeight }">
    <div ref="editorContainer" class="codemirror-container"></div>
  </div>
</template>

<style scoped>
.markdown-editor {
  width: 100%;
  border-radius: 8px;
  border: 1px solid hsl(var(--border));
  background: #282c34;
  overflow: hidden;
  transition: border-color 0.15s ease;
}

.markdown-editor:focus-within {
  border-color: hsl(var(--primary));
  outline: none;
  box-shadow: 0 0 0 1px hsl(var(--primary) / 0.2);
}

.codemirror-container {
  width: 100%;
  height: 100%;
  min-height: inherit;
}

/* CodeMirror 主题自定义 */
.markdown-editor :deep(.cm-editor) {
  height: 100%;
  min-height: inherit;
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Courier New', monospace;
  font-size: 14px;
}

.markdown-editor :deep(.cm-scroller) {
  overflow: auto;
  min-height: inherit;
}

.markdown-editor :deep(.cm-content) {
  padding: 12px;
  min-height: inherit;
}

.markdown-editor :deep(.cm-line) {
  padding: 2px 0;
  line-height: 1.6;
}

/* Placeholder 样式 */
.markdown-editor :deep(.cm-placeholder) {
  color: #6c6f85;
  font-style: italic;
}

/* 只读模式 */
.markdown-editor.readonly {
  opacity: 0.7;
  cursor: not-allowed;
}

.markdown-editor.readonly :deep(.cm-content) {
  background: rgba(0, 0, 0, 0.1);
}

/* Markdown 语法高亮优化 */
.markdown-editor :deep(.cm-line .ͼ1) {
  color: #61afef;
}

.markdown-editor :deep(.cm-line .ͼ2) {
  color: #98c379;
  font-weight: 600;
}

.markdown-editor :deep(.cm-line .ͼ3) {
  color: #e06c75;
}
</style>
