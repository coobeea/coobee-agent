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
  <div class="flex h-full w-full flex-col bg-background">
    <!-- Thread 不存在 -->
    <div
      v-if="!currentThread && threadsStore.threads.length > 0"
      class="flex flex-1 items-center justify-center bg-background">
      <div class="flex max-w-[360px] flex-col items-center px-10 text-center">
        <div class="mb-6 flex h-[72px] w-[72px] items-center justify-center rounded-[20px] bg-error/10 text-error/50">
          <span class="i-carbon-warning-alt inline-block h-8 w-8" />
        </div>
        <h2 class="mb-2 text-[17px] font-semibold text-foreground">任务不存在</h2>
        <p class="mb-7 text-[13px] leading-7 text-muted-foreground/75">
          未找到任务 ID: {{ threadId }}<br />
          可能已被删除或不存在
        </p>
        <button
          class="inline-flex h-9 items-center gap-2 rounded-[9px] bg-primary px-5 text-[13px] font-medium text-primary-foreground transition-all hover:bg-primary-hover hover:shadow-[0_2px_12px_hsl(var(--primary)/0.2)]"
          @click="goBackToAgents">
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
        class="flex w-6 flex-shrink-0 cursor-pointer items-center justify-center border-r border-border/40 bg-surface/50 text-muted-foreground/30 transition-all hover:bg-surface hover:text-muted-foreground/60"
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
            class="flex h-6 w-full flex-shrink-0 items-center gap-1 border-t border-border/30 bg-muted/20 px-2.5 text-[11px] text-muted-foreground/50 transition-all hover:bg-muted/40 hover:text-foreground/70"
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

      <div class="flex w-[400px] flex-shrink-0 min-h-0 flex-col">
        <ChatPanel ref="chatPanelRef" :thread-id="threadId" />
      </div>
    </div>
  </div>
</template>
