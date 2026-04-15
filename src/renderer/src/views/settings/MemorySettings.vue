<script setup lang="ts">
/**
 * MemorySettings - 记忆管理组件
 *
 * 展示 Agent 工作空间中的记忆文件
 */

import { ref, onMounted } from 'vue';

interface MemoryFile {
  name: string;
  path: string;
  size: number;
  mtime: string;
  scope: string;
}

const files = ref<MemoryFile[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const selectedFile = ref<MemoryFile | null>(null);
const fileContent = ref<string>('');
const contentLoading = ref(false);

async function loadFiles(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    // TODO: 对接后端 API
    await new Promise(resolve => setTimeout(resolve, 800));
    
    files.value = [
      {
        name: 'MEMORY.md',
        path: '/workspace/agent-1/MEMORY.md',
        size: 1024,
        mtime: new Date().toISOString(),
        scope: 'workspace:agent-1'
      },
      {
        name: 'user-preferences.json',
        path: '/workspace/global/user-preferences.json',
        size: 512,
        mtime: new Date(Date.now() - 86400000).toISOString(),
        scope: 'global'
      }
    ];
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function selectFile(file: MemoryFile): Promise<void> {
  selectedFile.value = file;
  contentLoading.value = true;
  try {
    // TODO: 对接后端 API
    await new Promise(resolve => setTimeout(resolve, 500));
    
    if (file.name === 'MEMORY.md') {
      fileContent.value = '# Agent Memory\n\n- User prefers dark mode\n- Project uses Vue 3 and Tailwind CSS\n- Always use TypeScript';
    } else {
      fileContent.value = '{\n  "theme": "dark",\n  "language": "zh-CN"\n}';
    }
  } catch {
    fileContent.value = '(读取失败)';
  } finally {
    contentLoading.value = false;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function scopeLabel(scope: string): string {
  if (scope === 'global') return '全局';
  if (scope.startsWith('workspace:')) {
    const id = scope.slice(10);
    return id.length > 12 ? id.slice(0, 12) + '...' : id;
  }
  return scope;
}

onMounted(() => {
  loadFiles();
});
</script>

<template>
  <div class="flex h-full bg-background text-foreground">
    <!-- 左侧：记忆文件列表 -->
    <div class="flex w-72 flex-col border-r border-border bg-surface">
      <div class="flex-1 overflow-y-auto p-4">
        <!-- 加载中 -->
        <div v-if="loading" class="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <span class="i-carbon-circle-dash mb-3 inline-block h-8 w-8 animate-spin text-primary/70"></span>
          <p class="text-sm font-medium">加载中...</p>
        </div>

        <!-- 错误 -->
        <div v-else-if="error" class="p-4 text-sm text-red-500 bg-red-500/10 rounded-xl mx-2 mt-2 text-center">
          {{ error }}
        </div>

        <!-- 空状态 -->
        <div
          v-else-if="files.length === 0"
          class="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <span class="i-carbon-document-blank mb-4 inline-block h-10 w-10 opacity-30"></span>
          <p class="text-sm font-medium">暂无记忆文件</p>
          <p class="mt-1.5 text-xs text-muted-foreground/70">Agent 运行时会自动生成记忆</p>
        </div>

        <!-- 文件列表 -->
        <div v-else class="flex flex-col gap-2">
          <button
            v-for="file in files"
            :key="file.path"
            :class="[
              'group flex flex-col w-full text-left rounded-xl px-4 py-3.5 transition-all duration-200 border',
              selectedFile?.path === file.path 
                ? 'bg-primary border-primary text-primary-foreground shadow-md' 
                : 'bg-card border-border/50 text-foreground hover:border-primary/30 hover:shadow-sm hover:-translate-y-px'
            ]"
            @click="selectFile(file)">
            <div class="flex items-center gap-3 w-full">
              <div :class="[
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors shadow-sm',
                selectedFile?.path === file.path 
                  ? 'bg-white/20 text-white' 
                  : 'bg-primary/10 text-primary group-hover:bg-primary/20'
              ]">
                <span class="i-carbon-document text-lg"></span>
              </div>
              <div class="flex flex-col overflow-hidden">
                <span :class="['truncate text-[14px] font-semibold tracking-tight', selectedFile?.path === file.path ? 'text-white' : 'text-foreground']">{{ file.name }}</span>
                <span :class="['mt-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium w-fit', selectedFile?.path === file.path ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground']">{{ scopeLabel(file.scope) }}</span>
              </div>
            </div>
            <div :class="['mt-3 flex items-center gap-3 text-[11px] font-medium', selectedFile?.path === file.path ? 'text-primary-foreground/80' : 'text-muted-foreground/70']">
              <span class="flex items-center gap-1.5"><span class="i-carbon-data-base h-3.5 w-3.5 opacity-70"></span>{{ formatSize(file.size) }}</span>
              <span class="flex items-center gap-1.5"><span class="i-carbon-time h-3.5 w-3.5 opacity-70"></span>{{ formatDate(file.mtime) }}</span>
            </div>
          </button>
        </div>
      </div>
    </div>

    <!-- 右侧：文件内容 -->
    <div class="flex-1 overflow-hidden bg-background flex flex-col">
      <div v-if="selectedFile" class="flex h-full flex-col">
        <div class="flex items-center justify-between border-b border-border px-8 py-5 bg-card/50">
          <div>
            <h3 class="text-xl font-bold tracking-tight text-foreground">{{ selectedFile.name }}</h3>
            <p class="mt-1.5 text-sm text-muted-foreground font-mono bg-muted/50 px-2 py-0.5 rounded-md w-fit border border-border/50">{{ selectedFile.path }}</p>
          </div>
          <div class="flex items-center gap-2">
            <button class="flex items-center gap-2 px-4 py-2 bg-background border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors shadow-sm">
              <span class="i-carbon-edit"></span>
              编辑
            </button>
          </div>
        </div>
        
        <div class="flex-1 overflow-y-auto p-8">
          <div v-if="contentLoading" class="flex flex-col items-center justify-center h-full text-muted-foreground">
            <span class="i-carbon-circle-dash animate-spin text-4xl mb-4 text-primary/70"></span>
            <span class="text-sm font-medium">读取内容中...</span>
          </div>
          <div v-else class="h-full rounded-xl border border-border bg-card shadow-sm overflow-hidden flex flex-col">
            <div class="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
              <span class="text-xs font-medium text-muted-foreground uppercase tracking-wider">文件内容</span>
              <button class="text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-muted">
                <span class="i-carbon-copy text-sm"></span>
              </button>
            </div>
            <pre class="flex-1 overflow-auto whitespace-pre-wrap text-sm font-mono p-5 text-foreground/90">{{ fileContent }}</pre>
          </div>
        </div>
      </div>
      
      <div v-else class="flex h-full items-center justify-center text-muted-foreground">
        <div class="text-center">
          <span class="i-carbon-document text-5xl mb-4 opacity-20 block mx-auto"></span>
          <p class="text-lg font-medium text-foreground">未选择文件</p>
          <p class="mt-2 text-sm">请在左侧选择一个记忆文件进行查看</p>
        </div>
      </div>
    </div>
  </div>
</template>
