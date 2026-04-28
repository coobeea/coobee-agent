<script setup lang="ts">
/**
 * WorkbenchPanel — 工作台（中栏）
 *
 * 支持多标签页的文件查看器。
 * 左侧 ProjectPanel 点击文件 → 在此处用 Monaco Editor 展示。
 * 无打开文件时显示空状态引导。
 */

import { ref, watch, onMounted, onBeforeUnmount, nextTick, shallowRef, computed, defineAsyncComponent } from 'vue';
import { monaco } from '@/utils/monaco-setup';
import { useOpenFiles, type OpenFile } from '@/composables/useOpenFiles';
import { routePreview, type PreviewMode } from '@/utils/previewRouter';
import eventBus from '@/eventbus';
import { EventTypes } from '@shared/events/ipc';

/** 判断当前是否为暗色模式（支持 class 和 prefers-color-scheme） */
function isDarkMode(): boolean {
  return (
    document.documentElement.classList.contains('dark') || window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

/** 根据暗色模式返回 Monaco 主题 */
function getMonacoTheme(): 'vs' | 'vs-dark' {
  return isDarkMode() ? 'vs-dark' : 'vs';
}

const PDFViewer = defineAsyncComponent(() => import('./preview/PDFViewer.vue'));
const ImageViewer = defineAsyncComponent(() => import('./preview/ImageViewer.vue'));
const VideoPlayer = defineAsyncComponent(() => import('./preview/VideoPlayer.vue'));
const HTMLPreview = defineAsyncComponent(() => import('./preview/HTMLPreview.vue'));
const MarkdownPreview = defineAsyncComponent(() => import('./preview/MarkdownPreview.vue'));

const { openFiles, activeFilePath, activeFile, closeFile, activateFile, loadMoreContent } = useOpenFiles();

const editorContainer = ref<HTMLDivElement | null>(null);
const editorInstance = shallowRef<monaco.editor.IStandaloneCodeEditor | null>(null);

const previewMode = computed<PreviewMode>(() => {
  if (!activeFile.value) return 'code';
  if (activeFile.value.isWebUrl) return 'web';
  const result = routePreview(activeFile.value.path);
  return result.mode;
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
    case 'web':
      return HTMLPreview;
    case 'markdown':
      return MarkdownPreview;
    default:
      return null;
  }
});

function initEditor(): void {
  if (!editorContainer.value) {
    return;
  }

  // 如果编辑器已存在，检查它是否还连接到正确的 DOM
  if (editorInstance.value) {
    const domNode = editorInstance.value.getDomNode();
    const containerHasEditor = domNode && editorContainer.value.contains(domNode);

    if (!containerHasEditor) {
      editorInstance.value.dispose();
      editorInstance.value = null;
    } else {
      return;
    }
  }

  editorInstance.value = monaco.editor.create(editorContainer.value, {
    value: '',
    language: 'plaintext',
    theme: getMonacoTheme(),
    readOnly: true,
    minimap: { enabled: false },
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "'Menlo', 'Monaco', 'Consolas', monospace",
    scrollBeyondLastLine: false,
    automaticLayout: true,
    wordWrap: 'on',
    renderLineHighlight: 'none',
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    scrollbar: {
      verticalScrollbarSize: 4,
      horizontalScrollbarSize: 4,
      useShadows: false
    },
    padding: { top: 8 }
  });

  // 设置滚动监听（用于大文件自动加载更多）
  setupScrollListener();
}

/** 根据当前主题更新 Monaco 编辑器主题 */
function applyMonacoTheme(): void {
  if (editorInstance.value) {
    monaco.editor.setTheme(getMonacoTheme());
  }
}

function updateEditorContent(): void {
  if (!editorInstance.value) {
    return;
  }

  const file = activeFile.value;
  if (!file || file.loading) {
    editorInstance.value.setValue('');
    return;
  }

  const model = editorInstance.value.getModel();
  if (model) {
    monaco.editor.setModelLanguage(model, file.language);
  }

  // 更新内容（保持光标位置）
  const currentPosition = editorInstance.value.getPosition();
  editorInstance.value.setValue(file.content);
  editorInstance.value.layout();

  // 如果是追加内容（分块加载），恢复光标位置
  if (file.chunked && currentPosition && currentPosition.lineNumber > 1) {
    editorInstance.value.setPosition(currentPosition);
  } else {
    editorInstance.value.revealLine(1);
  }
}

/**
 * 监听编辑器滚动，接近底部时自动加载更多内容
 */
function setupScrollListener(): void {
  if (!editorInstance.value) return;

  editorInstance.value.onDidScrollChange((e) => {
    const file = activeFile.value;
    if (!file || !file.chunked || !file.hasMore || file.loadingMore) {
      return;
    }

    // 滚动到底部 5% 时触发加载
    const scrollTop = e.scrollTop;
    const scrollHeight = e.scrollHeight;
    const clientHeight = editorContainer.value?.clientHeight ?? 0;

    const threshold = scrollHeight - clientHeight * 1.05;

    if (scrollTop >= threshold) {
      handleLoadMore();
    }
  });
}

async function handleLoadMore(): Promise<void> {
  if (!activeFile.value || !activeFile.value.hasMore || activeFile.value.loadingMore) {
    return;
  }

  await loadMoreContent(activeFile.value.path);

  // 内容已追加，触发更新
  updateEditorContent();
}

watch(
  () => {
    const f = activeFile.value;
    if (!f) return null;
    return `${f.path}::${f.loading}::${f.content.length}`;
  },
  async () => {
    // 会话切换导致文件全部关闭 → 销毁编辑器实例
    if (openFiles.value.length === 0) {
      if (editorInstance.value) {
        editorInstance.value.dispose();
        editorInstance.value = null;
      }
      return;
    }

    // 有文件但编辑器未初始化 → 初始化编辑器
    if (openFiles.value.length > 0 && !editorInstance.value) {
      await nextTick();
      initEditor();
    }

    await nextTick();
    updateEditorContent();
  }
);

// 主题变更监听：matchMedia + config:theme:changed
let mediaQueryList: MediaQueryList | null = null;

onMounted(async () => {
  if (openFiles.value.length > 0) {
    await nextTick();
    initEditor();
    updateEditorContent();
  }

  // 监听系统/Electron 主题变化（prefers-color-scheme）
  mediaQueryList = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQueryList.addEventListener('change', applyMonacoTheme);

  // 监听配置主题变更（用户切换 light/dark/auto）
  eventBus.on(EventTypes.CONFIG_THEME_CHANGED, applyMonacoTheme);
});

onBeforeUnmount(() => {
  mediaQueryList?.removeEventListener('change', applyMonacoTheme);
  mediaQueryList = null;
  eventBus.off(EventTypes.CONFIG_THEME_CHANGED, applyMonacoTheme);
  editorInstance.value?.dispose();
  editorInstance.value = null;
});

function getFileIcon(file: OpenFile): string {
  if (file.isWebUrl) return 'i-carbon-earth text-blue-400';
  const ext = file.name.split('.').pop()?.toLowerCase();
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
      return 'i-carbon-html text-orange-500';
    default:
      return 'i-carbon-document-blank text-muted-foreground';
  }
}
</script>

<template>
  <main class="flex h-full min-w-0 flex-1 flex-col bg-background">
    <!-- 无打开文件 — 空状态 -->
    <template v-if="openFiles.length === 0">
      <div class="flex h-9 shrink-0 items-center border-b border-border/45 bg-surface/30 px-3.5">
        <div class="flex items-center gap-1.5">
          <span class="i-carbon-workspace inline-block h-3.5 w-3.5 text-muted-foreground/60"></span>
          <span class="text-xs font-semibold text-muted-foreground/80">工作台</span>
        </div>
      </div>
      <div class="flex flex-1 flex-col items-center justify-center">
        <div class="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-surface">
          <span class="i-carbon-document-view inline-block h-6 w-6 text-muted-foreground/35"></span>
        </div>
        <p class="mb-1 text-[13px] font-medium text-muted-foreground/70">点击左侧文件查看内容</p>
        <p class="text-xs text-muted-foreground/40">支持语法高亮、多标签页浏览</p>
      </div>
    </template>

    <!-- 有打开文件 — 标签页 + 编辑器 -->
    <template v-else>
      <!-- 标签页栏 -->
      <div class="flex h-8 shrink-0 items-end overflow-x-auto border-b border-border/45 bg-surface/45">
        <div
          v-for="file in openFiles"
          :key="file.path"
          class="tab-item"
          :class="{ active: file.path === activeFilePath }"
          :title="file.path"
          @click="activateFile(file.path)">
          <span :class="getFileIcon(file)" class="inline-block h-3.5 w-3.5 shrink-0"></span>
          <span class="max-w-[160px] truncate text-[12px]">{{ file.name }}</span>
          <button class="tab-close" @click.stop="closeFile(file.path)">
            <span class="i-carbon-close inline-block h-3 w-3"></span>
          </button>
        </div>
      </div>

      <!-- 加载中（覆盖层） -->
      <div v-if="activeFile?.loading" class="flex flex-1 items-center justify-center">
        <span class="i-carbon-renew inline-block h-5 w-5 animate-spin text-muted-foreground/35"></span>
      </div>

      <!-- 错误提示（覆盖层） -->
      <div v-if="activeFile?.error" class="flex flex-1 flex-col items-center justify-center gap-3 p-6">
        <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-warning/10">
          <span class="i-carbon-warning-alt inline-block h-6 w-6 text-warning"></span>
        </div>
        <div class="text-center">
          <p class="mb-1 text-[13px] font-medium text-foreground/80">无法预览此文件</p>
          <p class="max-w-md text-xs leading-relaxed text-muted-foreground">
            {{ activeFile.error }}
          </p>
        </div>
        <div class="flex items-center gap-2 text-xs text-muted-foreground/65">
          <span class="i-carbon-document inline-block h-3.5 w-3.5"></span>
          <span>{{ activeFile.name }}</span>
        </div>
      </div>

      <!-- 🆕 多模态预览容器 -->
      <div
        v-show="activeFile && !activeFile.loading && !activeFile.error"
        class="relative flex min-h-0 flex-1 flex-col">
        <!-- 特殊格式预览（根据文件类型自动切换） -->
        <Transition name="preview-fade" mode="out-in">
          <component
            :is="previewComponent"
            v-if="previewComponent"
            :key="activeFile!.path"
            :file-path="activeFile!.path"
            :content="activeFile!.content"
            class="min-h-0 flex-1" />
        </Transition>

        <!-- Monaco Editor（代码文件） -->
        <div v-if="!previewComponent" ref="editorContainer" class="min-h-0 flex-1 bg-background"></div>

        <!-- 大文件加载提示（底部浮动） -->
        <div
          v-if="activeFile && activeFile.chunked && (activeFile.hasMore || activeFile.loadingMore)"
          class="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-lg border border-border/65 bg-background px-3 py-1.5 text-[11px]">
          <template v-if="activeFile.loadingMore">
            <span class="i-carbon-renew inline-block h-3.5 w-3.5 animate-spin text-primary"></span>
            <span class="text-muted-foreground">加载中...</span>
          </template>
          <template v-else-if="activeFile.hasMore">
            <span class="text-muted-foreground">
              已加载 {{ ((activeFile.offset ?? 0) + (activeFile.limit ?? 0)).toLocaleString() }} /
              {{ activeFile.totalLines?.toLocaleString() }} 行
            </span>
            <button
              class="ml-1.5 rounded-md bg-primary px-2.5 py-0.5 font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
              @click="handleLoadMore">
              加载更多
            </button>
          </template>
        </div>
      </div>
    </template>
  </main>
</template>

<style scoped>
.tab-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 10px;
  height: 32px;
  cursor: pointer;
  color: hsl(var(--muted-foreground) / 0.7);
  border-right: 1px solid hsl(var(--border) / 0.25);
  white-space: nowrap;
  transition: all 0.15s ease;
  position: relative;
  background: transparent;
}

.tab-item:hover {
  color: hsl(var(--foreground) / 0.9);
  background: hsl(var(--surface) / 0.75);
}

.tab-item.active {
  color: hsl(var(--foreground));
  background: hsl(var(--background));
  font-weight: 500;
}

.tab-item.active::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1.5px;
  background-color: hsl(var(--primary));
}

.tab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  margin-left: 2px;
  opacity: 0;
  color: hsl(var(--muted-foreground) / 0.5);
  transition: all 0.15s ease;
}

.tab-item:hover .tab-close {
  opacity: 1;
}

.tab-close:hover {
  background: hsl(var(--foreground) / 0.08);
  color: hsl(var(--foreground));
}
</style>
