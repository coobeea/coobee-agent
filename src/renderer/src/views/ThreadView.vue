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

const route = useRoute();
const router = useRouter();
const agentsStore = useAgentsStore();
const threadsStore = useThreadsStore();
const { closeAllFiles } = useOpenFiles();

const leftCollapsed = ref(false);
const terminalCollapsed = ref(true);
const chatPanelRef = ref<InstanceType<typeof ChatPanel> | null>(null);

const projectPath = ref<string | null>(null);

// 任务会话ID
const threadId = computed(() => route.params.id as string);

// 当前 Thread
const currentThread = computed(() => {
  return threadsStore.threads.find((t) => t.id === threadId.value);
});

// 目录切换：智能体目录 / 任务目录
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
function getTaskWorkspacePath(thread: { sessionPath?: string }): string {
  // 任务目录：当前 Thread 的会话产物目录
  // = .home/agents/{agentId}/sessions/{threadId}
  return thread.sessionPath || '';
}

function updateProjectPathForMode(thread: { agentHomePath?: string; sessionPath?: string }): void {
  if (directoryMode.value === 'agent-home') {
    projectPath.value = thread.agentHomePath || '';
  } else {
    projectPath.value = getTaskWorkspacePath(thread);
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
  threadsStore.clearSelection();
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
  <div class="thread-workspace flex h-full w-full flex-col bg-background">
    <!-- Thread 不存在 -->
    <div
      v-if="!currentThread && threadsStore.threads.length > 0"
      class="flex flex-1 items-center justify-center bg-background">
      <div class="flex max-w-[320px] flex-col items-center px-6 text-center">
        <div class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-error/10 text-error/50">
          <span class="i-carbon-warning-alt inline-block h-6 w-6" />
        </div>
        <h2 class="mb-1.5 text-[15px] font-semibold text-foreground">任务不存在</h2>
        <p class="mb-5 text-[12px] leading-6 text-muted-foreground/75">
          未找到任务 ID: {{ threadId }}<br />
          可能已被删除或不存在
        </p>
        <button
          class="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-4 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
          @click="goBackToAgents">
          <span class="i-carbon-arrow-left inline-block h-3.5 w-3.5" />
          <span>返回列表</span>
        </button>
      </div>
    </div>

    <!-- 已选目录：三栏工作区 -->
    <div v-else class="flex min-h-0 flex-1">
      <!-- 左侧折叠时的展开条 -->
      <div
        v-if="leftCollapsed"
        class="flex w-6 flex-shrink-0 cursor-pointer items-center justify-center border-r border-border/45 bg-muted/10 text-muted-foreground/35 transition-colors hover:bg-muted/25 hover:text-muted-foreground/70"
        title="展开文件面板"
        @click="leftCollapsed = false">
        <span class="i-carbon-chevron-right inline-block h-3 w-3"></span>
      </div>
      <ProjectPanel
        v-if="!leftCollapsed"
        v-model:collapsed="leftCollapsed"
        v-model:project-path="projectPath"
        :thread-id="threadId" />

      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <WorkbenchPanel />
        <!-- 终端面板（可折叠） -->
        <div
          class="flex min-h-0 flex-shrink-0 flex-col transition-[height] duration-150"
          :class="terminalCollapsed ? 'h-auto' : 'h-[200px]'">
          <button
            class="flex h-6 w-full flex-shrink-0 items-center gap-1 border-t border-border/35 bg-muted/15 px-2.5 text-[11px] text-muted-foreground/55 transition-colors hover:bg-muted/25 hover:text-foreground/75"
            @click="terminalCollapsed = !terminalCollapsed">
            <span
              class="inline-block h-3 w-3 transition-transform"
              :class="terminalCollapsed ? 'i-carbon-chevron-up' : 'i-carbon-chevron-down'">
            </span>
            <span class="text-[11px]">终端</span>
          </button>
          <TerminalPanel v-if="!terminalCollapsed" :thread-id="threadId" />
        </div>
      </div>

      <div class="flex min-h-0 w-[380px] flex-shrink-0 flex-col border-l border-border/45">
        <ChatPanel ref="chatPanelRef" :thread-id="threadId" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.thread-workspace {
  font-family: 'Avenir Next', 'PingFang SC', 'Microsoft YaHei', sans-serif;
}
</style>
