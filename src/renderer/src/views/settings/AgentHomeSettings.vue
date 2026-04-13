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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
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
    <div class="flex w-56 flex-col border-r border-border bg-card">
      <div class="border-b border-border px-4 py-3">
        <h2 class="text-sm font-semibold">Agent 列表</h2>
      </div>
      <div class="flex-1 overflow-y-auto p-2">
        <div v-if="agentsLoading" class="flex justify-center py-4">
          <span class="i-carbon-circle-dash animate-spin text-muted-foreground"></span>
        </div>
        <button
          v-for="agent in agents"
          :key="agent.id"
          class="w-full flex items-center px-3 py-2 rounded-md text-sm mb-1 transition-colors text-left"
          :class="selectedAgentId === agent.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted text-foreground'"
          @click="selectAgent(agent.id)"
        >
          <span class="i-carbon-user-avatar mr-2"></span>
          <span class="truncate">{{ agent.name }}</span>
        </button>
      </div>
    </div>

    <!-- 第二栏：文件列表 -->
    <div class="flex w-64 flex-col border-r border-border bg-card">
      <div class="border-b border-border px-4 py-3">
        <h2 class="text-sm font-semibold">配置文件</h2>
      </div>
      <div class="flex-1 overflow-y-auto p-2">
        <div v-if="!selectedAgentId" class="text-center py-8 text-xs text-muted-foreground">
          请先选择一个 Agent
        </div>
        <div v-else-if="filesLoading" class="flex justify-center py-4">
          <span class="i-carbon-circle-dash animate-spin text-muted-foreground"></span>
        </div>
        <div v-else>
          <button
            v-for="file in files"
            :key="file.name"
            class="w-full flex flex-col px-3 py-2 rounded-md text-sm mb-1 transition-colors text-left"
            :class="selectedFileName === file.name ? 'bg-primary/10 text-primary' : 'hover:bg-muted text-foreground'"
            @click="selectFile(file.name)"
          >
            <div class="flex items-center">
              <span class="i-carbon-document mr-2 text-muted-foreground"></span>
              <span class="font-medium truncate">{{ file.name }}</span>
            </div>
            <div class="flex items-center justify-between mt-1 text-[10px] text-muted-foreground pl-6">
              <span class="bg-muted px-1 rounded">{{ file.category }}</span>
              <span>{{ formatSize(file.size) }} · {{ formatDate(file.mtime) }}</span>
            </div>
          </button>
        </div>
      </div>
    </div>

    <!-- 第三栏：编辑器 -->
    <div class="flex-1 flex flex-col bg-background">
      <div v-if="selectedFileName" class="flex-1 flex flex-col">
        <div class="border-b border-border px-4 py-3 flex justify-between items-center bg-card">
          <h2 class="text-sm font-semibold">{{ selectedFileName }}</h2>
          <button class="px-3 py-1 bg-primary text-primary-foreground rounded text-xs">保存</button>
        </div>
        <div class="flex-1 p-4 overflow-y-auto">
          <div v-if="contentLoading" class="flex justify-center items-center h-full">
            <span class="i-carbon-circle-dash animate-spin text-2xl text-muted-foreground"></span>
          </div>
          <textarea 
            v-else
            v-model="fileContent"
            class="w-full h-full p-4 font-mono text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none"
          ></textarea>
        </div>
      </div>
      <div v-else class="flex-1 flex items-center justify-center text-muted-foreground">
        <div class="text-center">
          <span class="i-carbon-document text-4xl mb-3 opacity-20 block mx-auto"></span>
          <p>请选择一个文件进行编辑</p>
        </div>
      </div>
    </div>
  </div>
</template>
