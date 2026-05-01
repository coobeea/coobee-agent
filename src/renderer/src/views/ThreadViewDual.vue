<script setup lang="ts">
/**
 * ThreadViewDual — 动态双栏任务工作区
 *
 * 左栏：上下文 +（有打开文件时）工作台 + 对话。
 * 工作台 = 多标签编辑器：从右侧文件树点开文件后才出现，避免空状态长期占屏。
 * 右栏：可折叠抽屉，「文件 / 终端」标签切换（保留 ThreadView.vue 三栏版可随时切回）
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
import FilePreviewModal from '@/components/common/FilePreviewModal.vue';

const route = useRoute();
const router = useRouter();
const agentsStore = useAgentsStore();
const threadsStore = useThreadsStore();
const { closeAllFiles, openFiles } = useOpenFiles();

/** 有已打开的标签页时才渲染工作台，否则对话区占满主列 */
const showWorkbench = computed(() => openFiles.value.length > 0);

const chatPanelRef = ref<InstanceType<typeof ChatPanel> | null>(null);
const projectPath = ref<string | null>(null);
/** ProjectPanel v-model:collapsed；抽屉内不设为 true，避免内容被 v-show 隐藏 */
const projectPanelCollapsedStub = ref(false);

// 文件预览弹窗状态
const filePreviewVisible = ref(false);
const previewFilePath = ref('');
const previewFileName = ref('');

/** 右侧抽屉是否展开 */
const rightDrawerOpen = ref(false);
/** 右侧当前入口 */
const rightTab = ref<'agent-home' | 'workspace' | 'project' | 'terminal'>('agent-home');

const threadId = computed(() => route.params.id as string);

const currentThread = computed(() => threadsStore.threads.find((t) => t.id === threadId.value));

type DirectoryMode = 'agent-home' | 'workspace' | 'project';
const directoryMode = computed<DirectoryMode>(() => {
  if (rightTab.value === 'workspace') return 'workspace';
  if (rightTab.value === 'project') return 'project';
  return 'agent-home';
});

function addToChat(node: { path: string; name: string; type: 'file' | 'directory' }): void {
  chatPanelRef.value?.insertFileReference({
    path: node.path,
    name: node.name
  });
}

// 打开文件预览弹窗
function openFilePreview(filePath: string): void {
  const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || '未命名文件';
  previewFilePath.value = filePath;
  previewFileName.value = fileName;
  filePreviewVisible.value = true;
}

provide('addToChat', addToChat);
provide('addFileToTask', undefined);
provide('openFilePreview', openFilePreview);
provide('directoryMode', directoryMode);
provide('toggleDirectoryMode', toggleDirectoryMode);

async function updateProjectPathForMode(thread: {
  agentId?: string;
  agentHomePath?: string;
  agentProjectPath?: string;
  projectPath?: string;
  agentWorkspacePath?: string;
  workspacePath?: string;
  sessionPath?: string;
}): Promise<void> {
  if (rightTab.value === 'agent-home') {
    projectPath.value = thread.agentHomePath || '';
  } else if (rightTab.value === 'workspace') {
    // 任务目录：当前 Thread 的会话产物目录
    // = .home/agents/{agentId}/sessions/{threadId}
    projectPath.value = thread.sessionPath || '';
  } else if (rightTab.value === 'project') {
    // 项目目录：Agent 级跨任务共享的业务项目目录
    // = .home/agents/{agentId}/project
    projectPath.value = thread.agentProjectPath || thread.projectPath || thread.agentWorkspacePath || thread.workspacePath || '';
  }
}

async function toggleDirectoryMode(): Promise<void> {
  const thread = currentThread.value;
  if (!thread) return;
  rightTab.value = rightTab.value === 'agent-home' ? 'workspace' : 'agent-home';
  await updateProjectPathForMode(thread);
}

async function enterWorkspaceForThread(id: string): Promise<void> {
  const thread = threadsStore.threads.find((t) => t.id === id);
  rightTab.value = 'agent-home';
  if (thread) {
    agentsStore.selectAgent(thread.agentId);
    await updateProjectPathForMode(thread);
  }
  threadsStore.selectThread(id);
  closeAllFiles();
}

function goBackToAgents(): void {
  closeAllFiles();
  threadsStore.clearSelection();
  router.push('/agents');
}

async function openRightPanel(tab: 'agent-home' | 'workspace' | 'project' | 'terminal'): Promise<void> {
  rightTab.value = tab;
  rightDrawerOpen.value = true;
  const thread = currentThread.value;
  if (thread && tab !== 'terminal') {
    await updateProjectPathForMode(thread);
  }
}

onMounted(async () => {
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

watch(
  () => rightTab.value,
  async (tab) => {
    const thread = currentThread.value;
    if (!thread || tab === 'terminal') return;
    await updateProjectPathForMode(thread);
  }
);
</script>

<template>
  <!-- 包裹所有内容，确保只有一个根节点 -->
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

    <!-- 双栏主布局 -->
    <div v-else class="flex min-h-0 flex-1">
      <!-- 左栏：上下文 + 工作台 + 对话 -->
      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <WorkbenchPanel v-if="showWorkbench" class="min-h-0 flex-[1.1] border-b border-border/20" />
        <ChatPanel ref="chatPanelRef" border-variant="stacked" class="min-h-0 flex-1" :thread-id="threadId" />
      </div>

      <!-- 右侧：折叠态窄轨 -->
      <div
        v-if="!rightDrawerOpen"
        class="flex w-10 shrink-0 flex-col items-center gap-1 border-l border-border/45 bg-muted/10 py-2 transition-colors duration-200">
        <button
          type="button"
          title="智能体"
          class="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          @click="openRightPanel('agent-home')">
          <span class="i-carbon-user-avatar inline-block h-4 w-4" />
        </button>
        <button
          type="button"
          title="任务目录"
          class="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          @click="openRightPanel('workspace')">
          <span class="i-carbon-folder-shared inline-block h-4 w-4" />
        </button>
        <button
          type="button"
          title="项目目录"
          class="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          @click="openRightPanel('project')">
          <span class="i-carbon-folder-details inline-block h-4 w-4" />
        </button>
        <button
          type="button"
          title="终端"
          class="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          @click="openRightPanel('terminal')">
          <span class="i-carbon-terminal inline-block h-4 w-4" />
        </button>
      </div>

      <!-- 右侧：展开抽屉 -->
      <Transition name="thread-drawer">
        <aside
          v-if="rightDrawerOpen"
          key="thread-right-drawer"
          class="flex h-full w-[min(100%,390px)] shrink-0 flex-col border-l border-border/45 bg-background">
          <!-- 标签栏 -->
          <div class="flex h-10 shrink-0 items-center gap-0.5 border-b border-border/45 px-1.5">
            <button
              type="button"
              class="rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors"
              :class="
                rightTab === 'agent-home'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'
              "
              @click="openRightPanel('agent-home')">
              <span class="i-carbon-user-avatar mr-1 inline-block h-3.5 w-3.5 align-middle" />
              智能体
            </button>
            <button
              type="button"
              class="rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors"
              :class="
                rightTab === 'workspace'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'
              "
              @click="openRightPanel('workspace')">
              <span class="i-carbon-folder-shared mr-1 inline-block h-3.5 w-3.5 align-middle" />
              任务目录
            </button>
            <button
              type="button"
              class="rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors"
              :class="
                rightTab === 'project'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'
              "
              @click="openRightPanel('project')">
              <span class="i-carbon-folder-details mr-1 inline-block h-3.5 w-3.5 align-middle" />
              项目目录
            </button>
            <button
              type="button"
              class="rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors"
              :class="
                rightTab === 'terminal'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'
              "
              @click="openRightPanel('terminal')">
              <span class="i-carbon-terminal mr-1 inline-block h-3.5 w-3.5 align-middle" />
              终端
            </button>
            <button
              type="button"
              title="收起侧栏"
              class="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
              @click="rightDrawerOpen = false">
              <span class="i-carbon-chevron-right inline-block h-3.5 w-3.5" />
            </button>
          </div>

          <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div v-show="rightTab !== 'terminal'" class="flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/5">
              <ProjectPanel
                v-model:project-path="projectPath"
                v-model:collapsed="projectPanelCollapsedStub"
                embedded
                :directory-mode="directoryMode"
                :show-mode-switcher="false"
                :show-header="false"
                class="min-h-0 flex-1"
                :thread-id="threadId" />
            </div>
            <div v-show="rightTab === 'terminal'" class="flex min-h-0 flex-1 flex-col">
              <TerminalPanel :thread-id="threadId" />
            </div>
          </div>
        </aside>
      </Transition>
    </div>

    <!-- 文件预览弹窗 (使用 Teleport，不会影响布局) -->
    <FilePreviewModal
      v-model:visible="filePreviewVisible"
      :file-path="previewFilePath"
      :file-name="previewFileName"
      @close="filePreviewVisible = false" />
  </div>
</template>

<style scoped>
.thread-workspace {
  font-family: 'Avenir Next', 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

.thread-drawer-enter-active,
.thread-drawer-leave-active {
  transition:
    opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.thread-drawer-enter-from,
.thread-drawer-leave-to {
  opacity: 0;
  transform: translateX(10px);
}

@media (prefers-reduced-motion: reduce) {
  .thread-drawer-enter-active,
  .thread-drawer-leave-active {
    transition: none;
  }

  .thread-drawer-enter-from,
  .thread-drawer-leave-to {
    transform: none;
  }
}
</style>
