<script setup lang="ts">
/**
 * ThreadView — 任务工作区视图
 *
 * 根据路由参数 :id 加载 Thread，展示三栏工作区（任务工作目录 | 工作台 | 对话）。
 */

import { ref, computed, watch, onMounted, provide } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAgentsStore } from '@/stores/agents';
import { useThreadsStore } from '@/stores/threads';
import { useOpenFiles } from '@/composables/useOpenFiles';

import ProjectPanel from '@/components/agent/ProjectPanel.vue';
import WorkbenchPanel from '@/components/agent/WorkbenchPanel.vue';
import ChatPanel from '@/components/agent/ChatPanel.vue';
import TerminalPanel from '@/components/agent/TerminalPanel.vue';
import ContextPanel from '@/components/agent/ContextPanel.vue';

const route = useRoute();
const router = useRouter();
const agentsStore = useAgentsStore();
const threadsStore = useThreadsStore();
const { closeAllFiles } = useOpenFiles();

const leftCollapsed = ref(false);
const terminalCollapsed = ref(true);
const chatPanelRef = ref<InstanceType<typeof ChatPanel> | null>(null);

const projectPath = ref<string | null>(null);
const workspaceReady = computed(() => projectPath.value !== null);

// 任务会话ID
const threadId = computed(() => route.params.id as string);

// 当前 Thread
const currentThread = computed(() => {
  return threadsStore.threads.find(t => t.id === threadId.value);
});

// 目录切换：智能体目录 / 任务工作目录
type DirectoryMode = 'agent-home' | 'workspace';
const directoryMode = ref<DirectoryMode>('agent-home');

// 提供 addToChat 方法给 ProjectPanel/FileTreeNode
function addToChat(node: { path: string; name: string; type: 'file' | 'directory' }): void {
  chatPanelRef.value?.insertFileReference({
    path: node.path,
    name: node.name
  });
}

provide('addToChat', addToChat);
provide('addFileToTask', undefined);
provide('directoryMode', directoryMode);
provide('toggleDirectoryMode', toggleDirectoryMode);

// 根据当前模式更新显示的目录路径
function updateProjectPathForMode(thread: { agentHomePath?: string; workspacePath?: string }): void {
  if (directoryMode.value === 'agent-home') {
    projectPath.value = thread.agentHomePath || thread.workspacePath || '';
  } else {
    projectPath.value = thread.workspacePath || thread.agentHomePath || '';
  }
}

// 切换目录模式
function toggleDirectoryMode(): void {
  const thread = currentThread.value;
  if (!thread) return;

  directoryMode.value = directoryMode.value === 'agent-home' ? 'workspace' : 'agent-home';
  updateProjectPathForMode(thread);
}

function enterWorkspaceForThread(id: string): void {
  const thread = threadsStore.threads.find((t) => t.id === id);

  directoryMode.value = 'agent-home';

  if (thread) {
    agentsStore.selectAgent(thread.agentId);
    updateProjectPathForMode(thread);
  }
  threadsStore.selectThread(id);
  closeAllFiles();
}

function goBackToAgents(): void {
  closeAllFiles();
  threadsStore.selectThread(null);
  router.push('/agents');
}

onMounted(async () => {
  // 确保 threads 已加载
  if (threadsStore.threads.length === 0) {
    await threadsStore.fetchThreads();
  }

  if (threadId.value) {
    enterWorkspaceForThread(threadId.value);
  }
});

watch(threadId, (newId) => {
  if (newId) {
    projectPath.value = null;
    enterWorkspaceForThread(newId);
  }
});
</script>

<template>
  <div class="thread-view">
    <!-- Thread 不存在 -->
    <div v-if="!currentThread && threadsStore.threads.length > 0" class="not-found">
      <div class="not-found-card">
        <div class="not-found-icon">
          <span class="i-carbon-warning-alt inline-block h-8 w-8" />
        </div>
        <h2 class="not-found-title">任务不存在</h2>
        <p class="not-found-desc">
          未找到任务 ID: {{ threadId }}<br />
          可能已被删除或不存在
        </p>
        <button class="not-found-btn" @click="goBackToAgents">
          <span class="i-carbon-arrow-left inline-block h-4 w-4" />
          <span>返回列表</span>
        </button>
      </div>
    </div>

    <!-- 已选目录：三栏工作区 -->
    <div v-else class="flex min-h-0 flex-1">
      <!-- 左侧折叠时的展开条 -->
      <div
        v-if="leftCollapsed"
        class="expand-bar left"
        title="展开文件面板"
        @click="leftCollapsed = false">
        <span class="i-carbon-chevron-right inline-block h-3 w-3"></span>
      </div>
      <ProjectPanel 
        v-if="!leftCollapsed"
        v-model:collapsed="leftCollapsed" 
        v-model:project-path="projectPath" 
        :thread-id="threadId" />
      
      <div class="middle-area">
        <WorkbenchPanel />
        <!-- 终端面板（可折叠） -->
        <div class="terminal-section" :class="{ collapsed: terminalCollapsed }">
          <button class="terminal-toggle" @click="terminalCollapsed = !terminalCollapsed">
            <span
              class="inline-block h-3 w-3 transition-transform"
              :class="terminalCollapsed ? 'i-carbon-chevron-up' : 'i-carbon-chevron-down'">
            </span>
            <span class="text-[11px]">终端</span>
          </button>
          <TerminalPanel v-if="!terminalCollapsed" :thread-id="threadId" />
        </div>
      </div>
      
      <div class="right-area">
        <ContextPanel :thread-id="threadId" />
        <ChatPanel ref="chatPanelRef" :thread-id="threadId" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.thread-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: hsl(var(--background));
}

.middle-area {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.terminal-section {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  height: 200px;
  min-height: 0;
  transition: height 0.15s ease;
}

.terminal-section.collapsed {
  height: auto;
}

.terminal-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 10px;
  border-top: 1px solid hsl(var(--border) / 0.3);
  background: hsl(var(--muted) / 0.2);
  color: hsl(var(--muted-foreground) / 0.5);
  font-size: 11px;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.1s ease;
  width: 100%;
}

.terminal-toggle:hover {
  background: hsl(var(--muted) / 0.4);
  color: hsl(var(--foreground) / 0.7);
}

.right-area {
  display: flex;
  flex-direction: column;
  width: 400px;
  flex-shrink: 0;
  min-height: 0;
}

.expand-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  flex-shrink: 0;
  cursor: pointer;
  background: hsl(var(--surface) / 0.5);
  color: hsl(var(--muted-foreground) / 0.3);
  transition: all 0.15s ease;
}

.expand-bar:hover {
  background: hsl(var(--surface));
  color: hsl(var(--muted-foreground) / 0.6);
}

.expand-bar.left {
  border-right: 1px solid hsl(var(--border) / 0.4);
}

/* 未找到页面 */
.not-found {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  background: hsl(var(--background));
}

.not-found-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  max-width: 360px;
  padding: 40px;
}

.not-found-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  border-radius: 20px;
  background: hsl(var(--error) / 0.08);
  color: hsl(var(--error) / 0.5);
  margin-bottom: 24px;
}

.not-found-title {
  font-size: 17px;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin-bottom: 8px;
}

.not-found-desc {
  font-size: 13px;
  line-height: 1.7;
  color: hsl(var(--muted-foreground) / 0.75);
  margin-bottom: 28px;
}

.not-found-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 20px;
  border-radius: 9px;
  font-size: 13px;
  font-weight: 500;
  color: hsl(var(--primary-foreground));
  background: hsl(var(--primary));
  transition: all 0.15s ease;
}

.not-found-btn:hover {
  background: hsl(var(--primary-hover));
  box-shadow: 0 2px 12px hsl(var(--primary) / 0.2);
}
</style>
