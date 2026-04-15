<script setup lang="ts">
/**
 * AgentHomeSettings - Agent 人格与记忆管理
 *
 * 三栏布局：左侧 Agent 列表、中间文件列表、右侧编辑器
 */

import { ref, onMounted } from 'vue';

interface AgentHome {
  id: string;
  name: string;
}

interface HomeFile {
  name: string;
  size: number;
  mtime: string;
  category: 'config' | 'memory';
}

const agents = ref<AgentHome[]>([]);
const agentsLoading = ref(true);
const selectedAgentId = ref<string | null>(null);

const files = ref<HomeFile[]>([]);
const filesLoading = ref(false);
const selectedFileName = ref<string | null>(null);

const fileContent = ref('');
const contentLoading = ref(false);

async function loadAgents(): Promise<void> {
  agentsLoading.value = true;
  try {
    // TODO: 对接后端 API
    await new Promise(resolve => setTimeout(resolve, 500));
    agents.value = [
      { id: 'agent-1', name: 'Code Assistant' },
      { id: 'agent-2', name: 'Data Analyst' }
    ];
  } catch (err) {
    console.error('Agent 列表加载失败', err);
  } finally {
    agentsLoading.value = false;
  }
}

async function loadFiles(agentId: string): Promise<void> {
  console.log('Loading files for agent:', agentId);
  filesLoading.value = true;
  files.value = [];
  selectedFileName.value = null;
  fileContent.value = '';
  
  try {
    // TODO: 对接后端 API
    await new Promise(resolve => setTimeout(resolve, 500));
    files.value = [
      { name: 'INSTRUCTIONS.md', size: 1024, mtime: new Date().toISOString(), category: 'config' },
      { name: 'MEMORY.md', size: 2048, mtime: new Date().toISOString(), category: 'memory' }
    ];
  } catch (err) {
    console.error('文件列表加载失败', err);
  } finally {
    filesLoading.value = false;
  }
}

async function loadFileContent(fileName: string): Promise<void> {
  contentLoading.value = true;
  try {
    // TODO: 对接后端 API
    await new Promise(resolve => setTimeout(resolve, 500));
    if (fileName === 'INSTRUCTIONS.md') {
      fileContent.value = '# You are a helpful coding assistant.\n\nAlways write clean, well-documented code.';
    } else {
      fileContent.value = '# Memory\n\nUser prefers TypeScript over JavaScript.';
    }
  } catch (err) {
    console.error('文件内容加载失败', err);
    fileContent.value = '读取失败';
  } finally {
    contentLoading.value = false;
  }
}

function selectAgent(id: string) {
  selectedAgentId.value = id;
  loadFiles(id);
}

function selectFile(name: string) {
  selectedFileName.value = name;
  loadFileContent(name);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

onMounted(() => {
  loadAgents();
});
</script>

<template>
  <div class="flex h-full bg-background text-foreground">
    <!-- 第一栏：Agent 列表 -->
    <div class="flex w-64 flex-col border-r border-border bg-surface">
      <div class="flex-1 overflow-y-auto p-4">
        <div v-if="agentsLoading" class="flex flex-col items-center justify-center py-10 text-muted-foreground">
          <span class="i-carbon-circle-dash animate-spin text-2xl mb-3 text-primary/70"></span>
          <p class="text-sm font-medium">加载中...</p>
        </div>
        <div v-else class="flex flex-col gap-2">
          <button
            v-for="agent in agents"
            :key="agent.id"
            class="group flex w-full items-center px-4 py-3.5 rounded-xl text-sm transition-all duration-200 border text-left"
            :class="selectedAgentId === agent.id ? 'bg-primary border-primary text-primary-foreground shadow-md' : 'bg-card border-border/50 text-foreground hover:border-primary/30 hover:shadow-sm hover:-translate-y-px'"
            @click="selectAgent(agent.id)"
          >
            <div :class="['flex h-9 w-9 items-center justify-center rounded-xl mr-3.5 shrink-0 shadow-sm transition-colors', selectedAgentId === agent.id ? 'bg-white/20 text-white' : 'bg-primary/10 text-primary group-hover:bg-primary/20']">
              <span class="i-carbon-user-avatar text-lg"></span>
            </div>
            <div class="flex flex-col overflow-hidden">
              <span :class="['truncate font-semibold tracking-tight text-[14px]', selectedAgentId === agent.id ? 'text-white' : 'text-foreground']">{{ agent.name }}</span>
              <span :class="['mt-1 text-[11px] font-mono truncate', selectedAgentId === agent.id ? 'text-primary-foreground/80' : 'text-muted-foreground/70']">{{ agent.id }}</span>
            </div>
          </button>
        </div>
      </div>
    </div>

    <!-- 第二栏：文件列表 -->
    <div class="flex w-72 flex-col border-r border-border bg-surface">
      <div class="flex-1 overflow-y-auto p-4">
        <div v-if="!selectedAgentId" class="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <span class="i-carbon-user-avatar mb-4 inline-block h-10 w-10 opacity-30"></span>
          <p class="text-sm font-medium">请先选择一个 Agent</p>
        </div>
        <div v-else-if="filesLoading" class="flex flex-col items-center justify-center py-10 text-muted-foreground">
          <span class="i-carbon-circle-dash animate-spin text-2xl mb-3 text-primary/70"></span>
          <p class="text-sm font-medium">加载中...</p>
        </div>
        <div v-else class="flex flex-col gap-2">
          <button
            v-for="file in files"
            :key="file.name"
            class="group flex w-full flex-col px-4 py-3.5 rounded-xl text-sm transition-all duration-200 border text-left"
            :class="selectedFileName === file.name ? 'bg-primary border-primary shadow-md' : 'bg-card border-border/50 hover:border-primary/30 hover:shadow-sm hover:-translate-y-px'"
            @click="selectFile(file.name)"
          >
            <div class="flex items-center gap-3 w-full">
              <div :class="['flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors shadow-sm', selectedFileName === file.name ? 'bg-white/20 text-white' : 'bg-primary/10 text-primary group-hover:bg-primary/20']">
                <span class="i-carbon-document text-lg"></span>
              </div>
              <span :class="['truncate font-semibold tracking-tight text-[14px]', selectedFileName === file.name ? 'text-white' : 'text-foreground']">{{ file.name }}</span>
            </div>
            <div :class="['flex items-center gap-3 mt-3 pl-11 text-[11px]', selectedFileName === file.name ? 'text-primary-foreground/80' : 'text-muted-foreground/70']">
              <span :class="['rounded-md px-1.5 py-0.5 font-medium uppercase tracking-wider', selectedFileName === file.name ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground']">{{ file.category }}</span>
              <span class="flex items-center gap-1.5"><span class="i-carbon-data-base h-3.5 w-3.5 opacity-70"></span>{{ formatSize(file.size) }}</span>
            </div>
          </button>
        </div>
      </div>
    </div>

    <!-- 第三栏：编辑器 -->
    <div class="flex-1 flex flex-col bg-background">
      <div v-if="selectedFileName" class="flex-1 flex flex-col h-full">
        <div class="border-b border-border px-6 py-4 flex justify-between items-center bg-card/50">
          <div class="flex items-center gap-3">
            <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <span class="i-carbon-document text-xl"></span>
            </div>
            <div>
              <h2 class="text-lg font-bold tracking-tight">{{ selectedFileName }}</h2>
              <p class="text-xs text-muted-foreground font-mono mt-0.5">{{ selectedAgentId }}/{{ selectedFileName }}</p>
            </div>
          </div>
          <button class="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm">
            <span class="i-carbon-save"></span>
            保存修改
          </button>
        </div>
        <div class="flex-1 p-6 overflow-hidden flex flex-col">
          <div v-if="contentLoading" class="flex flex-col items-center justify-center h-full text-muted-foreground">
            <span class="i-carbon-circle-dash animate-spin text-4xl mb-4 text-primary/70"></span>
            <span class="text-sm font-medium">读取内容中...</span>
          </div>
          <div v-else class="flex-1 rounded-xl border border-border bg-card shadow-sm overflow-hidden flex flex-col">
            <div class="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
              <span class="text-xs font-medium text-muted-foreground uppercase tracking-wider">文件内容 (Markdown)</span>
              <div class="flex items-center gap-1">
                <button class="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded hover:bg-muted" title="格式化">
                  <span class="i-carbon-text-align-left text-sm"></span>
                </button>
                <button class="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded hover:bg-muted" title="复制">
                  <span class="i-carbon-copy text-sm"></span>
                </button>
              </div>
            </div>
            <textarea 
              v-model="fileContent"
              class="flex-1 w-full p-5 font-mono text-sm bg-transparent border-none focus:outline-none focus:ring-0 resize-none text-foreground/90 leading-relaxed"
              spellcheck="false"
            ></textarea>
          </div>
        </div>
      </div>
      <div v-else class="flex-1 flex items-center justify-center text-muted-foreground">
        <div class="text-center">
          <span class="i-carbon-document text-5xl mb-4 opacity-20 block mx-auto"></span>
          <p class="text-lg font-medium text-foreground">未选择文件</p>
          <p class="mt-2 text-sm">请在左侧选择一个文件进行编辑</p>
        </div>
      </div>
    </div>
  </div>
</template>
