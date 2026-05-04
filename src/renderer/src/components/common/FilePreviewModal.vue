<script setup lang="ts">
/**
 * FilePreviewModal - 文件预览弹出框
 *
 * 支持多种文件类型的预览：
 * - 普通文本文件：语法高亮展示
 * - HTML 文件：支持渲染预览和源码查看两种模式
 * - 图片：直接预览
 * - 其他：根据扩展名适配
 */

import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { getFileContent } from '@/api/workspace';
import configManager from '@/config';

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

// HTML 文件的显示模式
const viewMode = ref<'preview' | 'source'>('preview');

// 文件类型判断
const fileExtension = computed(() => {
  const parts = props.fileName.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
});

const isHtmlFile = computed(() => {
  return ['html', 'htm'].includes(fileExtension.value);
});

const isImageFile = computed(() => {
  return ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(fileExtension.value);
});

const isMarkdownFile = computed(() => {
  return ['md', 'markdown'].includes(fileExtension.value);
});

const isJsonFile = computed(() => {
  return ['json', 'json5'].includes(fileExtension.value);
});

const isCssFile = computed(() => {
  return ['css', 'scss', 'sass', 'less'].includes(fileExtension.value);
});

const isCodeFile = computed(() => {
  return ['js', 'ts', 'jsx', 'tsx', 'vue', 'py', 'java', 'c', 'cpp', 'go', 'rs', 'php', 'rb'].includes(
    fileExtension.value
  );
});

// 格式化的文件内容（用于 JSON 等）
const formattedContent = computed(() => {
  if (isJsonFile.value) {
    try {
      const parsed = JSON.parse(fileContent.value);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return fileContent.value;
    }
  }
  return fileContent.value;
});

// 文件大小
const fileSize = ref<string>('');

// 语法高亮类名
const syntaxClass = computed(() => {
  if (isCodeFile.value) return 'language-' + fileExtension.value;
  if (isJsonFile.value) return 'language-json';
  if (isCssFile.value) return 'language-css';
  if (isMarkdownFile.value) return 'language-markdown';
  return '';
});

// 加载文件内容
async function loadFileContent(): Promise<void> {
  if (!props.filePath) return;

  loading.value = true;
  error.value = null;

  try {
    const result = await getFileContent(props.filePath);
    fileContent.value = result.content;

    // 计算文件大小
    const sizeInBytes = new Blob([result.content]).size;
    if (sizeInBytes < 1024) {
      fileSize.value = `${sizeInBytes} B`;
    } else if (sizeInBytes < 1024 * 1024) {
      fileSize.value = `${(sizeInBytes / 1024).toFixed(2)} KB`;
    } else {
      fileSize.value = `${(sizeInBytes / (1024 * 1024)).toFixed(2)} MB`;
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : '读取文件失败';
    console.error('[FilePreviewModal] 读取文件失败:', err);
  } finally {
    loading.value = false;
  }
}

// 关闭弹窗
function close(): void {
  emit('update:visible', false);
  emit('close');
}

// ESC 键关闭
function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.visible) {
    close();
  }
}

// 监听 visible 变化
watch(
  () => props.visible,
  (newVal) => {
    if (newVal) {
      loadFileContent();
      viewMode.value = 'preview';
    } else {
      fileContent.value = '';
      error.value = null;
    }
  }
);

onMounted(() => {
  document.addEventListener('keydown', handleKeydown);
  if (props.visible) {
    loadFileContent();
  }
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
});

// 图片 URL
const imageUrl = computed(() => {
  return `${configManager.getBaseUrl()}/gateway/files/serve?path=${encodeURIComponent(props.filePath)}`;
});
</script>

<template>
  <!-- 遮罩层 -->
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="visible"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
        @click.self="close">
        <!-- 弹窗主体 -->
        <div
          class="relative flex flex-col w-[90vw] h-[85vh] max-w-6xl bg-background rounded-xl shadow-2xl border border-border overflow-hidden">
          <!-- 头部 -->
          <div class="flex items-center justify-between h-14 px-5 border-b border-border bg-muted/30 shrink-0">
            <div class="flex items-center gap-3 flex-1 min-w-0">
              <span
                class="shrink-0 text-lg"
                :class="{
                  'i-carbon-document-blank': !isCodeFile && !isImageFile && !isHtmlFile && !isJsonFile,
                  'i-carbon-code': isCodeFile,
                  'i-carbon-image': isImageFile,
                  'i-carbon-html': isHtmlFile,
                  'i-carbon-data-structured': isJsonFile
                }"></span>
              <div class="flex flex-col min-w-0">
                <h3 class="text-sm font-semibold text-foreground truncate">{{ fileName }}</h3>
                <p v-if="fileSize" class="text-xs text-muted-foreground">{{ fileSize }}</p>
              </div>
            </div>

            <!-- HTML 文件的视图切换 -->
            <div v-if="isHtmlFile && !loading && !error" class="flex items-center gap-1 mr-3">
              <button
                type="button"
                class="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
                :class="viewMode === 'preview' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted'"
                @click="viewMode = 'preview'">
                <span class="i-carbon-view mr-1 inline-block align-middle"></span>
                预览
              </button>
              <button
                type="button"
                class="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
                :class="viewMode === 'source' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted'"
                @click="viewMode = 'source'">
                <span class="i-carbon-code mr-1 inline-block align-middle"></span>
                源码
              </button>
            </div>

            <button
              type="button"
              class="flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              @click="close">
              <span class="i-carbon-close text-lg"></span>
            </button>
          </div>

          <!-- 内容区 -->
          <div class="flex-1 overflow-hidden">
            <!-- 加载中 -->
            <div v-if="loading" class="flex flex-col items-center justify-center h-full gap-3">
              <span class="i-carbon-renew inline-block h-8 w-8 animate-spin text-primary"></span>
              <p class="text-sm text-muted-foreground">加载中...</p>
            </div>

            <!-- 错误 -->
            <div v-else-if="error" class="flex flex-col items-center justify-center h-full gap-3">
              <span class="i-carbon-warning inline-block h-8 w-8 text-destructive"></span>
              <p class="text-sm text-foreground">{{ error }}</p>
              <button
                type="button"
                class="px-4 py-2 text-sm rounded-lg bg-secondary hover:bg-secondary/80 transition-colors"
                @click="loadFileContent">
                重试
              </button>
            </div>

            <!-- HTML 预览模式 -->
            <iframe
              v-else-if="isHtmlFile && viewMode === 'preview'"
              :srcdoc="fileContent"
              class="w-full h-full border-0 bg-white"
              sandbox="allow-scripts allow-same-origin"></iframe>

            <!-- 图片预览 -->
            <div v-else-if="isImageFile" class="h-full overflow-auto flex items-center justify-center bg-muted/10 p-8">
              <img :src="imageUrl" :alt="fileName" class="max-w-full max-h-full object-contain shadow-lg rounded-lg" />
            </div>

            <!-- 源码/文本内容 -->
            <div v-else class="h-full overflow-auto p-5 bg-muted/5">
              <pre
                class="text-[13px] font-mono text-foreground leading-relaxed whitespace-pre-wrap break-words rounded-lg p-4 bg-background/50 border border-border/50"
                :class="syntaxClass"><code>{{ formattedContent }}</code></pre>
            </div>
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
</style>
