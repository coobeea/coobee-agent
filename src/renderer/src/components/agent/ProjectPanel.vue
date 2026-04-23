<script setup lang="ts">
/**
 * ProjectPanel — 任务工作目录（左栏）
 *
 * 显示项目目录的文件树，通过 HTTP API 获取目录结构。
 * 支持目录展开/折叠、文件类型图标、手动刷新、文件选中。
 * 自动监听文件变化并刷新树。
 * 支持切换显示"智能体目录"或"任务工作目录"。
 */
import { ref, watch, provide, onUnmounted, inject, computed, type Ref } from 'vue';
import { useOpenFiles } from '@/composables/useOpenFiles';
import { watchThreadFiles, type WorkspaceFileChangedPayload } from '@/composables/useWorkspaceWatcher';
import { useLogStore } from '@/stores/log';
import {
  getFileTree,
  deleteNode as deleteNodeApi,
  copyFileToWorkspace as copyFileApi,
  uploadFile as uploadFileApi,
  type FileNode
} from '@/api/workspace';
import FileTreeNodeVue from './FileTreeNode.vue';

const logStore = useLogStore();

// 从 ThreadView 注入目录模式
type DirectoryMode = 'agent-home' | 'workspace' | 'project';
const injectedDirectoryMode = inject<Ref<DirectoryMode>>('directoryMode', ref('agent-home'));
const toggleDirectoryMode = inject<() => void>('toggleDirectoryMode', () => {});
const setProjectDir = inject<() => Promise<void>>('setProjectDir', async () => {});

const DIRECTORY_META: Record<DirectoryMode, { title: string; icon: string }> = {
  'agent-home': { title: '智能体', icon: 'i-carbon-user-avatar' },
  workspace: { title: '任务工作目录', icon: 'i-carbon-folder-shared' },
  project: { title: '数据目录', icon: 'i-carbon-folder-details' }
};

const props = withDefaults(
  defineProps<{
    threadId?: string;
    /** 嵌入右侧抽屉时：全宽、隐藏折叠按钮 */
    embedded?: boolean;
    /** 覆盖默认：是否显示折叠按钮（embedded 时默认 false） */
    showCollapseButton?: boolean;
    /** 是否显示顶部标题/操作栏 */
    showHeader?: boolean;
    /** 固定显示某个目录模式；不传则使用注入的目录模式 */
    directoryMode?: DirectoryMode;
    /** 是否显示内部“切换目录模式”按钮 */
    showModeSwitcher?: boolean;
  }>(),
  {
    embedded: false,
    showCollapseButton: undefined,
    showHeader: true,
    directoryMode: undefined,
    showModeSwitcher: true
  }
);

const showCollapse = computed(() => props.showCollapseButton ?? !props.embedded);
const effectiveDirectoryMode = computed(() => props.directoryMode ?? injectedDirectoryMode.value);
const directoryTitle = computed(() => DIRECTORY_META[effectiveDirectoryMode.value].title);
const directoryIcon = computed(() => DIRECTORY_META[effectiveDirectoryMode.value].icon);
const showModeSwitcher = computed(() => props.showModeSwitcher);

const projectPath = defineModel<string | null>('projectPath', { default: null });
const isCollapsed = defineModel<boolean>('collapsed', { default: false });

const tree = ref<FileNode[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const expandedDirs = ref<Set<string>>(new Set());
const selectedPath = ref<string | null>(null);

async function fetchTree(dirPath: string, depth = 3): Promise<FileNode[]> {
  const data = await getFileTree(dirPath, depth);
  return data.children;
}

async function loadTree(clearExpanded = false): Promise<void> {
  if (!projectPath.value) return;
  loading.value = true;
  error.value = null;
  try {
    tree.value = await fetchTree(projectPath.value);
    // 只在首次加载或切换目录时清空展开状态
    if (clearExpanded) {
      expandedDirs.value.clear();
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    tree.value = [];
  } finally {
    loading.value = false;
  }
}

async function toggleDir(node: FileNode): Promise<void> {
  if (node.type !== 'directory') return;

  if (expandedDirs.value.has(node.path)) {
    // 折叠目录
    expandedDirs.value.delete(node.path);
  } else {
    // 展开目录 - 每次都重新拉取最新数据
    expandedDirs.value.add(node.path);
    try {
      node.children = await fetchTree(node.path, 1);
    } catch {
      node.children = [];
    }
  }
}

const { openFile: openFileInWorkbench } = useOpenFiles();

// 从父组件注入打开文件预览的方法
const openFilePreview = inject<((filePath: string) => void) | undefined>('openFilePreview', undefined);

// 打开文件时设置选中状态
function handleOpenFile(filePath: string): void {
  selectedPath.value = filePath;
  // 优先使用弹窗预览，如果没有则在工作台打开
  if (openFilePreview) {
    openFilePreview(filePath);
  } else {
    openFileInWorkbench(filePath);
  }
}

// 复制文件到指定目录
async function handleCopyToDir(sourcePath: string, targetDir: string): Promise<void> {
  await copyFileToWorkspace(sourcePath, targetDir);
}

// 上传文件到指定目录
async function handleUploadFile(file: File, targetDir: string): Promise<void> {
  await uploadFileToWorkspace(file, targetDir);
}

// 删除文件/目录
async function handleDeleteNode(nodePath: string): Promise<void> {
  try {
    await deleteNodeApi(nodePath);
    logStore.info('user', '文件/目录删除成功', { path: nodePath });
    // 刷新文件树，保持展开状态
    await loadTree(false);
  } catch (err) {
    logStore.error('user', '文件/目录删除异常', { path: nodePath, error: err });
  }
}

// 处理粘贴事件（Cmd+V / Ctrl+V）
async function handlePaste(event: KeyboardEvent): Promise<void> {
  // 检查是否是 Cmd+V (Mac) 或 Ctrl+V (Windows/Linux)
  if ((event.metaKey || event.ctrlKey) && event.key === 'v') {
    event.preventDefault();

    try {
      // 从剪贴板读取文件路径
      const filePaths = await window.api?.getClipboardFiles();
      if (!filePaths || filePaths.length === 0) {
        logStore.debug('user', '剪贴板中没有文件');
        return;
      }

      // 确定目标目录：如果选中了目录节点，使用它；否则使用根目录
      let targetDir = projectPath.value;
      if (selectedPath.value) {
        const selectedNode = findNodeByPath(tree.value, selectedPath.value);
        if (selectedNode?.type === 'directory') {
          targetDir = selectedNode.path;
        } else if (selectedNode?.type === 'file') {
          // 如果选中的是文件，使用其父目录
          targetDir = selectedPath.value.substring(0, selectedPath.value.lastIndexOf('/'));
        }
      }

      if (!targetDir) {
        logStore.error('user', '无法确定粘贴目标目录', { selectedPath: selectedPath.value });
        return;
      }

      logStore.info('user', '粘贴文件到工作区', { targetDir, filePaths });

      // 复制所有文件/目录
      for (const sourcePath of filePaths) {
        await copyFileToWorkspace(sourcePath, targetDir);
      }
    } catch (err) {
      logStore.error('user', '粘贴文件失败', { error: err });
    }
  }
}

// 辅助函数：根据路径查找节点
function findNodeByPath(nodes: FileNode[], path: string): FileNode | null {
  for (const node of nodes) {
    if (node.path === path) {
      return node;
    }
    if (node.children) {
      const found = findNodeByPath(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

provide('expandedDirs', expandedDirs);
provide('toggleDir', toggleDir);
provide('openFile', handleOpenFile);
provide('selectedPath', selectedPath);
provide('copyToDir', handleCopyToDir);
provide('uploadFile', handleUploadFile);
provide('deleteNode', handleDeleteNode);

async function selectDirectory(): Promise<void> {
  try {
    const result = await window.api?.openDirectory();
    if (result) {
      projectPath.value = result;
    }
  } catch (err) {
    logStore.warn('user', '选择目录失败', { error: err });
  }
}

watch(
  projectPath,
  (newPath) => {
    if (newPath)
      loadTree(true); // 切换目录时清空展开状态
    else tree.value = [];
  },
  { immediate: true }
);

// 文件变化监听
let unwatchFiles: (() => void) | null = null;

watch(
  () => props.threadId,
  (newThreadId) => {
    // 清理旧订阅
    if (unwatchFiles) {
      unwatchFiles();
      unwatchFiles = null;
    }

    // 创建新订阅
    if (newThreadId) {
      unwatchFiles = watchThreadFiles(newThreadId, (payload: WorkspaceFileChangedPayload) => {
        logStore.debug('event', `检测到工作区文件变化: ${payload.files.join(', ')}`);
        // 自动刷新文件树，保持展开状态
        loadTree(false);
      });
    }
  },
  { immediate: true }
);

onUnmounted(() => {
  // 组件卸载时清理订阅
  if (unwatchFiles) {
    unwatchFiles();
  }
});

// ========== 文件复制功能 ==========

async function copyFileToWorkspace(sourcePath: string, targetDir: string): Promise<void> {
  try {
    const result = await copyFileApi(sourcePath, targetDir);
    logStore.info('user', '文件复制成功', { sourcePath, targetDir, targetPath: result.targetPath });
    // 刷新文件树，保持展开状态
    await loadTree(false);
  } catch (err) {
    logStore.error('user', '文件复制异常', { sourcePath, targetDir, error: err });
  }
}

async function uploadFileToWorkspace(file: File, targetDir: string): Promise<void> {
  try {
    // 读取文件内容为 base64
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
    const base64Content = btoa(binary);

    const result = await uploadFileApi({
      fileName: file.name,
      content: base64Content,
      targetDir,
      encoding: 'base64'
    });

    logStore.info('user', '文件上传成功', { fileName: file.name, targetDir, filePath: result.targetPath });
    // 刷新文件树，保持展开状态
    await loadTree(false);
  } catch (err) {
    logStore.error('user', '文件上传异常', { fileName: file.name, targetDir, error: err });
  }
}

defineExpose({ selectDirectory });
</script>

<template>
  <aside
    v-show="!isCollapsed"
    class="flex h-full flex-col border-r border-border/60 bg-muted/10"
    :class="props.embedded ? 'w-full min-w-0 flex-1' : 'w-64 shrink-0'"
    tabindex="0"
    @keydown="handlePaste">
    <div v-if="showHeader" class="flex h-9 shrink-0 items-center border-b border-border/50 px-2">
      <!-- 左侧：目录模式切换（点击循环切换） -->
      <button
        v-if="projectPath && showModeSwitcher"
        class="flex flex-1 items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:bg-muted/35"
        title="点击切换目录模式"
        @click="toggleDirectoryMode">
        <span :class="directoryIcon" class="inline-block h-3.5 w-3.5 text-muted-foreground"></span>
        <span class="truncate text-[13px] font-semibold text-foreground/85">{{ directoryTitle }}</span>
        <span class="i-carbon-chevron-sort inline-block h-3 w-3 shrink-0 text-muted-foreground/55"></span>
      </button>
      <div v-else class="flex flex-1 items-center gap-1.5 px-1">
        <span :class="directoryIcon" class="inline-block h-3.5 w-3.5 text-muted-foreground"></span>
        <span class="text-[13px] font-semibold text-foreground/85">{{ directoryTitle }}</span>
      </div>

      <!-- 右侧：操作按钮 -->
      <div class="flex items-center">
        <button
          v-if="projectPath"
          class="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted/45 hover:text-foreground/75"
          title="指定数据目录"
          @click="setProjectDir">
          <span class="i-carbon-folder-add inline-block h-3.5 w-3.5"></span>
        </button>
        <button
          v-if="projectPath"
          class="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted/45 hover:text-foreground/75"
          title="刷新"
          @click="() => loadTree(false)">
          <span class="i-carbon-renew inline-block h-3.5 w-3.5" :class="{ 'animate-spin': loading }"></span>
        </button>
        <button
          v-if="showCollapse"
          class="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted/45 hover:text-foreground/75"
          title="折叠面板"
          @click="isCollapsed = true">
          <span class="i-carbon-chevron-left inline-block h-3 w-3"></span>
        </button>
      </div>
    </div>

    <!-- 内容区域 -->
    <div class="flex-1 overflow-y-auto">
      <!-- 未选择目录 -->
      <div v-if="!projectPath" class="flex flex-col items-center p-3 pt-8">
        <div class="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-muted/45">
          <span class="i-carbon-folder-add inline-block h-5 w-5 text-muted-foreground/60"></span>
        </div>
        <p class="mb-1 text-[13px] font-medium text-muted-foreground">选择项目目录</p>
        <p class="mb-3 text-center text-xs leading-relaxed text-muted-foreground/65">
          Agent 将以此目录下的文件<br />作为工作上下文
        </p>
        <button
          class="flex items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
          @click="selectDirectory">
          <span class="i-carbon-folder-add inline-block h-4 w-4"></span>
          选择目录
        </button>
      </div>

      <!-- 已选择目录 -->
      <template v-else>
        <!-- 加载中 -->
        <div
          v-if="loading && tree.length === 0"
          class="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground/70">
          <span class="i-carbon-renew inline-block h-4 w-4 animate-spin"></span>
          <span>加载中...</span>
        </div>

        <!-- 错误 -->
        <div v-else-if="error" class="px-3 py-3">
          <div class="flex items-center gap-1.5 text-sm text-red-500">
            <span class="i-carbon-warning-alt inline-block h-4 w-4 shrink-0"></span>
            <span class="truncate">{{ error }}</span>
          </div>
          <button
            class="mt-2 text-xs text-muted-foreground transition-colors hover:text-primary"
            @click="() => loadTree(false)">
            重试
          </button>
        </div>

        <!-- 文件树 -->
        <div v-else class="py-0.5">
          <FileTreeNodeVue v-for="node in tree" :key="node.path" :node="node" :depth="0" />
          <div v-if="tree.length === 0 && !loading" class="px-3 py-3 text-center text-xs text-muted-foreground/65">
            空目录
          </div>
        </div>
      </template>
    </div>
  </aside>
</template>
