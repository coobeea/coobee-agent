<script setup lang="ts">
/**
 * FilePreviewModal - 通用文件预览弹窗
 *
 * 支持：
 * - 代码文件：Monaco Editor 语法高亮 + 编辑
 * - 图片：ImageViewer（缩放）
 * - HTML：预览/编辑模式切换
 * - Markdown：预览/编辑模式切换
 * - PDF：PDFViewer
 * - 视频：VideoPlayer
 */

import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, shallowRef, defineAsyncComponent } from 'vue';
import { monaco } from '@/utils/monaco-setup';
import { routePreview, type PreviewMode } from '@/utils/previewRouter';
import { getFileContent, saveFileContent } from '@/api/workspace';

const PDFViewer = defineAsyncComponent(() => import('@/components/agent/preview/PDFViewer.vue'));
const ImageViewer = defineAsyncComponent(() => import('@/components/agent/preview/ImageViewer.vue'));
const VideoPlayer = defineAsyncComponent(() => import('@/components/agent/preview/VideoPlayer.vue'));
const HTMLPreview = defineAsyncComponent(() => import('@/components/agent/preview/HTMLPreview.vue'));
const MarkdownPreview = defineAsyncComponent(() => import('@/components/agent/preview/MarkdownPreview.vue'));

interface Props {
  visible: boolean;
  filePath: string;
  fileName: string;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  'update:visible': [value: boolean];
  close: [];
}>();

const fileContent = ref<string>('');
const loading = ref(false);
const error = ref<string | null>(null);
const fileSize = ref<string>('');
const isDirty = ref(false);
const saving = ref(false);
const viewMode = ref<'preview' | 'edit'>('preview');

const previewMode = computed<PreviewMode>(() => {
  if (!props.filePath) return 'code';
  return routePreview(props.filePath).mode;
});

const canToggleMode = computed(() => {
  return previewMode.value === 'html' || previewMode.value === 'markdown';
});

const isEditing = computed(() => {
  if (previewMode.value === 'code') return true;
  if (canToggleMode.value && viewMode.value === 'edit') return true;
  return false;
});

const showPreviewComponent = computed(() => {
  if (!canToggleMode.value) return false;
  return viewMode.value === 'preview';
});

const previewComponent = computed(() => {
  switch (previewMode.value) {
    case 'pdf':
      return PDFViewer;
    case 'image':
      return ImageViewer;
    case 'video':
      return VideoPlayer;
    case 'html':
      return HTMLPreview;
    case 'markdown':
      return MarkdownPreview;
    default:
      return null;
  }
});

const needsTextContent = computed(() => {
  return ['code', 'html', 'markdown'].includes(previewMode.value);
});

function isDarkMode(): boolean {
  return (
    document.documentElement.classList.contains('dark') || window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

function getMonacoTheme(): 'vs' | 'vs-dark' {
  return isDarkMode() ? 'vs-dark' : 'vs';
}

const editorContainer = ref<HTMLDivElement | null>(null);
const editorInstance = shallowRef<monaco.editor.IStandaloneCodeEditor | null>(null);

function getFileLanguage(): string {
  const ext = props.fileName.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    jsonl: 'json',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    md: 'markdown',
    py: 'python',
    java: 'java',
    go: 'go',
    rs: 'rust',
    vue: 'html',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    sql: 'sql',
    sh: 'shell',
    bash: 'shell',
    dockerfile: 'dockerfile',
    makefile: 'makefile'
  };
  return langMap[ext] || 'plaintext';
}

function initEditor(): void {
  if (!editorContainer.value || editorInstance.value) return;

  editorInstance.value = monaco.editor.create(editorContainer.value, {
    value: '',
    language: 'plaintext',
    theme: getMonacoTheme(),
    readOnly: false,
    minimap: { enabled: false },
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "'Menlo', 'Monaco', 'Consolas', monospace",
    scrollBeyondLastLine: false,
    automaticLayout: true,
    wordWrap: 'on',
    renderLineHighlight: 'none',
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    scrollbar: {
      verticalScrollbarSize: 6,
      horizontalScrollbarSize: 6,
      useShadows: false
    },
    padding: { top: 12 }
  });

  editorInstance.value.onDidChangeModelContent(() => {
    const current = editorInstance.value?.getValue() || '';
    isDirty.value = current !== fileContent.value;
  });
}

function updateEditorContent(): void {
  if (!editorInstance.value) return;

  const model = editorInstance.value.getModel();
  if (model) {
    monaco.editor.setModelLanguage(model, getFileLanguage());
  }

  editorInstance.value.setValue(fileContent.value || '');
  editorInstance.value.revealLine(1);
}

function applyMonacoTheme(): void {
  if (editorInstance.value) {
    monaco.editor.setTheme(getMonacoTheme());
  }
}

async function loadFileContent(): Promise<void> {
  if (!props.filePath) return;

  loading.value = true;
  error.value = null;
  fileContent.value = '';
  isDirty.value = false;
  viewMode.value = 'preview';

  try {
    const result = await getFileContent(props.filePath);
    fileContent.value = result.content;

    const sizeInBytes = new Blob([result.content]).size;
    if (sizeInBytes < 1024) {
      fileSize.value = `${sizeInBytes} B`;
    } else if (sizeInBytes < 1024 * 1024) {
      fileSize.value = `${(sizeInBytes / 1024).toFixed(1)} KB`;
    } else {
      fileSize.value = `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`;
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : '读取文件失败';
  } finally {
    loading.value = false;
  }
}

function close(): void {
  emit('update:visible', false);
  emit('close');
}

async function saveFile(): Promise<void> {
  if (!editorInstance.value || !isDirty.value || saving.value) return;

  saving.value = true;
  try {
    const content = editorInstance.value.getValue();
    await saveFileContent(props.filePath, content);
    fileContent.value = content;
    isDirty.value = false;
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存文件失败';
  } finally {
    saving.value = false;
  }
}

function switchToEdit(): void {
  viewMode.value = 'edit';
}

function switchToPreview(): void {
  if (isDirty.value && editorInstance.value) {
    fileContent.value = editorInstance.value.getValue();
    isDirty.value = false;
  }
  viewMode.value = 'preview';
}

function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.visible) {
    close();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 's' && props.visible && isEditing.value) {
    e.preventDefault();
    saveFile();
  }
}

function getFileIcon(): string {
  const ext = props.fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'i-carbon-logo-typescript text-blue-500';
    case 'js':
    case 'jsx':
      return 'i-carbon-logo-javascript text-yellow-500';
    case 'vue':
      return 'i-carbon-application-web text-green-500';
    case 'json':
    case 'jsonl':
      return 'i-carbon-json text-amber-600';
    case 'md':
      return 'i-carbon-document text-muted-foreground';
    case 'css':
    case 'scss':
    case 'less':
      return 'i-carbon-color-palette text-pink-500';
    case 'html':
    case 'htm':
      return 'i-carbon-html text-orange-500';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
      return 'i-carbon-image text-emerald-500';
    case 'pdf':
      return 'i-carbon-document-attachment text-red-500';
    case 'mp4':
    case 'webm':
    case 'mov':
      return 'i-carbon-video text-purple-500';
    default:
      return 'i-carbon-document-blank text-muted-foreground';
  }
}

let mediaQueryList: MediaQueryList | null = null;

watch(
  () => props.visible,
  async (newVal) => {
    if (newVal) {
      await loadFileContent();
    } else {
      fileContent.value = '';
      error.value = null;
      isDirty.value = false;
      viewMode.value = 'preview';
      if (editorInstance.value) {
        editorInstance.value.dispose();
        editorInstance.value = null;
      }
    }
  }
);

watch([() => loading.value, () => fileContent.value, isEditing], async () => {
  if (loading.value || error.value || !fileContent.value) return;
  if (!isEditing.value) return;

  await nextTick();
  if (!editorInstance.value && editorContainer.value) {
    initEditor();
  }
  updateEditorContent();
});

onMounted(() => {
  document.addEventListener('keydown', handleKeydown);
  mediaQueryList = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQueryList.addEventListener('change', applyMonacoTheme);
  if (props.visible) {
    loadFileContent();
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown);
  mediaQueryList?.removeEventListener('change', applyMonacoTheme);
  mediaQueryList = null;
  if (editorInstance.value) {
    editorInstance.value.dispose();
    editorInstance.value = null;
  }
});
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="visible"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
        @click.self="close">
        <div
          class="relative flex flex-col w-[90vw] h-[85vh] max-w-6xl bg-background rounded-xl shadow-2xl border border-border overflow-hidden">
          <!-- 头部 -->
          <div class="flex items-center justify-between h-11 px-4 border-b border-border/60 shrink-0">
            <div class="flex items-center gap-2.5 flex-1 min-w-0">
              <span :class="getFileIcon()" class="inline-block h-4 w-4 shrink-0"></span>
              <div class="flex items-center gap-2 min-w-0">
                <h3 class="text-[13px] font-semibold text-foreground truncate">{{ fileName }}</h3>
                <span v-if="isDirty" class="shrink-0 text-[11px] text-primary">已修改</span>
                <span v-if="fileSize" class="shrink-0 text-[11px] text-muted-foreground/70">{{ fileSize }}</span>
              </div>
            </div>

            <div class="flex items-center gap-1.5 mr-2">
              <!-- 预览/编辑模式切换 -->
              <div v-if="canToggleMode" class="flex items-center h-7 rounded-md bg-muted/60 p-0.5">
                <button
                  type="button"
                  class="flex items-center gap-1 h-6 px-2 rounded-[5px] text-[11px] font-medium transition-colors"
                  :class="
                    viewMode === 'preview'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  "
                  @click="switchToPreview">
                  <span class="i-carbon-view inline-block h-3 w-3"></span>
                  <span>预览</span>
                </button>
                <button
                  type="button"
                  class="flex items-center gap-1 h-6 px-2 rounded-[5px] text-[11px] font-medium transition-colors"
                  :class="
                    viewMode === 'edit'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  "
                  @click="switchToEdit">
                  <span class="i-carbon-edit inline-block h-3 w-3"></span>
                  <span>编辑</span>
                </button>
              </div>

              <!-- 保存按钮 -->
              <button
                v-if="isDirty && isEditing"
                type="button"
                class="flex items-center gap-1 h-7 px-2.5 rounded-md text-[12px] font-medium bg-primary text-primary-foreground hover:bg-primary-hover transition-colors"
                :disabled="saving"
                @click="saveFile">
                <span v-if="saving" class="i-carbon-renew inline-block h-3 w-3 animate-spin"></span>
                <span v-else class="i-carbon-save inline-block h-3 w-3"></span>
                <span>{{ saving ? '保存中...' : '保存' }}</span>
              </button>
            </div>

            <button
              type="button"
              class="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              @click="close">
              <span class="i-carbon-close inline-block h-4 w-4"></span>
            </button>
          </div>

          <!-- 内容区 -->
          <div class="flex-1 overflow-hidden">
            <!-- 加载中 -->
            <div v-if="loading" class="flex flex-col items-center justify-center h-full gap-3">
              <span class="i-carbon-renew inline-block h-6 w-6 animate-spin text-primary/60"></span>
              <p class="text-[13px] text-muted-foreground">加载中...</p>
            </div>

            <!-- 错误 -->
            <div v-else-if="error" class="flex flex-col items-center justify-center h-full gap-3">
              <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-warning/10">
                <span class="i-carbon-warning-alt inline-block h-6 w-6 text-warning"></span>
              </div>
              <p class="text-[13px] text-foreground/80">{{ error }}</p>
              <button
                type="button"
                class="px-3 py-1.5 text-[12px] rounded-md bg-primary/10 text-primary hover:bg-primary/15 transition-colors"
                @click="loadFileContent">
                重试
              </button>
            </div>

            <!-- 内容展示 -->
            <template v-else>
              <!-- 非文本预览组件（图片/PDF/视频） -->
              <Transition name="preview-fade" mode="out-in">
                <component
                  :is="previewComponent"
                  v-if="previewComponent && !canToggleMode"
                  :key="filePath"
                  :file-path="filePath"
                  :content="fileContent"
                  class="h-full" />
              </Transition>

              <!-- MD/HTML 预览模式 -->
              <Transition name="preview-fade" mode="out-in">
                <component
                  :is="previewComponent"
                  v-if="showPreviewComponent"
                  :key="filePath + '-preview'"
                  :file-path="filePath"
                  :content="fileContent"
                  class="h-full" />
              </Transition>

              <!-- Monaco Editor（代码文件 + MD/HTML 编辑模式） -->
              <div v-show="isEditing && needsTextContent" ref="editorContainer" class="h-full bg-background"></div>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.modal-fade-enter-active .relative,
.modal-fade-leave-active .relative {
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}

.modal-fade-enter-from .relative {
  transform: scale(0.95);
  opacity: 0;
}

.modal-fade-leave-to .relative {
  transform: scale(0.95);
  opacity: 0;
}

.preview-fade-enter-active,
.preview-fade-leave-active {
  transition: opacity 0.15s ease;
}

.preview-fade-enter-from,
.preview-fade-leave-to {
  opacity: 0;
}
</style>
