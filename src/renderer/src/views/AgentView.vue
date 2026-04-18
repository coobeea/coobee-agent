<script setup lang="ts">
/**
 * AgentView — 智能体管理列表
 *
 * 基础的智能体 CRUD 界面：列表展示、搜索、排序、编辑、删除
 */

import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { toast } from 'vue-sonner';
import { useAgentsStore } from '@/stores/agents';
import { useThreadsStore } from '@/stores/threads';
import { useGateway } from '@/composables/useGateway';
import { importAgent, exportAgent } from '@/api/agents';

const agentsStore = useAgentsStore();
const threadsStore = useThreadsStore();
const router = useRouter();
const { request } = useGateway();

/** 删除确认 */
const confirmDeleteId = ref<string | null>(null);

/** 导入中 */
const importing = ref(false);

/** 创建任务中 */
const creatingTask = ref<string | null>(null);

/** 文件输入框引用 */
const fileInputRef = ref<HTMLInputElement | null>(null);

onMounted(() => {
  agentsStore.fetchAgents();
});

/** 按更新时间排序的智能体列表 */
const sortedAgents = computed(() => {
  const result = [...agentsStore.agents];
  // 默认按更新时间倒序
  result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return result;
});

/** 打开创建页面 */
function openCreatePage(): void {
  router.push('/agents/create');
}

/** 打开编辑页面 */
function openEditPage(agentId: string): void {
  router.push(`/agents/edit/${agentId}`);
}

/** 点击卡片 */
function handleCardClick(agentId: string, event: MouseEvent): void {
  // 如果点击的是按钮，不触发卡片点击
  const target = event.target as HTMLElement;
  if (target.closest('button')) {
    return;
  }
  openEditPage(agentId);
}

/** 开始新任务 */
async function startNewTask(agentId: string, event: MouseEvent): Promise<void> {
  event.stopPropagation();
  if (creatingTask.value) return;
  
  creatingTask.value = agentId;
  try {
    const res = await request('chat.createThread', { 
      title: '新任务', 
      agentId 
    });
    if (res && (res as any).id) {
      threadsStore.fetchThreads(); // 刷新列表
      router.push(`/thread/${(res as any).id}`);
    }
  } catch (err) {
    console.error('Failed to create thread:', err);
    toast.error('创建任务失败');
  } finally {
    creatingTask.value = null;
  }
}

/** 删除智能体 */
async function handleDelete(agentId: string, event: MouseEvent): Promise<void> {
  event.stopPropagation();
  
  if (confirmDeleteId.value !== agentId) {
    confirmDeleteId.value = agentId;
    return;
  }
  
  confirmDeleteId.value = null;
  await agentsStore.removeAgent(agentId);
}

/** 取消删除 */
function cancelDelete(event: MouseEvent): void {
  event.stopPropagation();
  confirmDeleteId.value = null;
}

/** 格式化时间 */
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60_000) return '刚刚';
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
    if (diff < 2592000_000) return `${Math.floor(diff / 86400_000)} 天前`;
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

/** 打开文件选择器 */
function openFileSelector(): void {
  fileInputRef.value?.click();
}

/** 处理文件选择 */
async function handleFileSelect(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  
  if (!file) return;
  
  // 验证文件类型
  if (!file.name.endsWith('.zip')) {
    toast.error('请选择 ZIP 文件');
    input.value = '';
    return;
  }
  
  importing.value = true;
  
  try {
    const result = await importAgent(file);
    
    if (result.success && result.data) {
      toast.success(`成功导入智能体: ${result.data.agentName || result.data.agentId}`);
      
      // 显示警告信息
      if (result.data.warnings && result.data.warnings.length > 0) {
        result.data.warnings.forEach((warning) => {
          toast.warning(warning);
        });
      }
      
      // 刷新列表
      await agentsStore.fetchAgents();
    } else {
      toast.error(result.error || '导入失败');
    }
  } catch (err) {
    console.error('[AgentView] Import error:', err);
    toast.error(err instanceof Error ? err.message : '导入失败');
  } finally {
    importing.value = false;
    input.value = '';
  }
}

/** 导出智能体 */
async function handleExport(agentId: string, agentName: string, event: MouseEvent): Promise<void> {
  event.stopPropagation();
  
  try {
    toast.loading('正在导出...');
    const blob = await exportAgent(agentId);
    
    // 创建下载链接
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${agentName}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    toast.success('导出成功');
  } catch (err) {
    console.error('[AgentView] Export error:', err);
    toast.error(err instanceof Error ? err.message : '导出失败');
  }
}
</script>

<template>
  <div class="flex h-full flex-col bg-background text-foreground">
    <!-- 顶栏 -->
    <header class="flex h-14 shrink-0 items-center justify-between border-b border-border/40 bg-surface/60 px-6 backdrop-blur">
      <div class="flex items-center gap-3">
        <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <span class="i-carbon-bot text-lg"></span>
        </div>
        <h1 class="text-base font-semibold tracking-tight">智能体</h1>
        <span v-if="agentsStore.agentCount > 0" class="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {{ agentsStore.agentCount }}
        </span>
      </div>
      
      <div class="flex items-center gap-2">
        <button 
          class="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" 
          title="刷新" 
          @click="agentsStore.fetchAgents()"
        >
          <span class="i-carbon-renew" :class="{ 'animate-spin': agentsStore.loading }"></span>
        </button>
        <button 
          class="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50" 
          title="导入智能体" 
          :disabled="importing" 
          @click="openFileSelector"
        >
          <span class="i-carbon-upload" :class="{ 'animate-pulse': importing }"></span>
        </button>
        <button 
          class="flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/20" 
          @click="openCreatePage"
        >
          <span class="i-carbon-add"></span>
          <span>新建</span>
        </button>
        <!-- 隐藏的文件输入框 -->
        <input
          ref="fileInputRef"
          type="file"
          accept=".zip"
          style="display: none"
          @change="handleFileSelect"
        />
      </div>
    </header>

    <!-- 内容区域 -->
    <div class="flex-1 overflow-y-auto p-6">
      
      <!-- 错误 -->
      <div v-if="agentsStore.error" class="mx-auto max-w-5xl mb-6 flex items-center gap-3 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        <span class="i-carbon-warning-alt shrink-0"></span>
        <span class="flex-1 truncate">{{ agentsStore.error }}</span>
        <button class="font-medium hover:underline" @click="agentsStore.fetchAgents()">重试</button>
      </div>

      <!-- 加载中 -->
      <div v-if="agentsStore.loading && agentsStore.agents.length === 0" class="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <span class="i-carbon-renew animate-spin text-3xl mb-4 opacity-50"></span>
        <p class="text-sm">加载中...</p>
      </div>

      <!-- 空状态 -->
      <div v-else-if="agentsStore.agents.length === 0 && !agentsStore.loading" class="mx-auto max-w-md flex flex-col items-center justify-center py-20 text-center">
        <div class="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary mb-6">
          <span class="i-carbon-bot text-3xl"></span>
        </div>
        <h3 class="text-lg font-medium mb-2">创建你的第一个智能体</h3>
        <p class="text-sm text-muted-foreground mb-6">智能体可以帮助你完成各种任务，定制专属的工作流程</p>
        <button 
          class="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90" 
          @click="openCreatePage"
        >
          <span class="i-carbon-add"></span>
          开始创建
        </button>
      </div>

      <!-- 智能体列表 -->
      <div v-else class="mx-auto max-w-6xl grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div
          v-for="agent in sortedAgents"
          :key="agent.id"
          class="group relative flex flex-col rounded-xl border border-border bg-card p-5 transition-all hover:border-primary/50 hover:shadow-md cursor-pointer"
          @click="handleCardClick(agent.id, $event)"
        >
          <!-- 头部 -->
          <div class="flex items-start justify-between mb-3">
            <div class="flex items-center gap-3 min-w-0">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                <span class="i-carbon-bot text-xl"></span>
              </div>
              <div class="flex flex-col min-w-0">
                <h3 class="truncate text-base font-medium text-foreground group-hover:text-primary transition-colors" :title="agent.name">
                  {{ agent.name }}
                </h3>
                <span class="text-xs text-muted-foreground">{{ formatTime(agent.updatedAt) }}</span>
              </div>
            </div>
            
            <!-- 快捷操作按钮 (Hover显示) -->
            <div class="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <template v-if="confirmDeleteId !== agent.id">
                <button 
                  class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors" 
                  title="导出" 
                  @click="handleExport(agent.id, agent.name, $event)"
                >
                  <span class="i-carbon-download"></span>
                </button>
                <button 
                  class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors" 
                  title="编辑" 
                  @click="openEditPage(agent.id)"
                >
                  <span class="i-carbon-edit"></span>
                </button>
                <button 
                  class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors" 
                  title="删除" 
                  @click="handleDelete(agent.id, $event)"
                >
                  <span class="i-carbon-trash-can"></span>
                </button>
              </template>
              <template v-else>
                <button class="rounded bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground hover:bg-destructive/90" @click="handleDelete(agent.id, $event)">确认</button>
                <button class="rounded bg-muted px-2 py-1 text-xs font-medium hover:bg-muted/80" @click="cancelDelete($event)">取消</button>
              </template>
            </div>
          </div>

          <!-- 描述 -->
          <p class="mb-4 text-sm text-muted-foreground line-clamp-2 flex-1">
            {{ agent.description || '暂无描述' }}
          </p>

          <!-- 底部信息 -->
          <div class="flex items-center justify-between mt-auto pt-4 border-t border-border/40">
            <div class="flex flex-col gap-2 min-w-0">
              <!-- 模型标签 -->
              <div v-if="agent.model" class="flex items-center gap-1.5 text-xs text-muted-foreground truncate" :title="agent.model">
                <span class="i-carbon-machine-learning-model shrink-0"></span>
                <span class="truncate">{{ agent.model.startsWith('@group:') ? agent.model.slice(7) : agent.model.split('/').pop() }}</span>
              </div>
              
              <!-- 技能标签 -->
              <div v-if="agent.skills && agent.skills.length > 0" class="flex items-center gap-1 flex-wrap">
                <span class="i-carbon-tool text-xs text-muted-foreground shrink-0"></span>
                <span v-for="skill in agent.skills.slice(0, 2)" :key="skill" class="rounded bg-secondary/50 px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
                  {{ skill }}
                </span>
                <span v-if="agent.skills.length > 2" class="rounded bg-secondary/50 px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
                  +{{ agent.skills.length - 2 }}
                </span>
              </div>
            </div>
            
            <!-- 开始任务按钮 -->
            <button 
              class="shrink-0 flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-all hover:bg-primary/90 shadow-sm hover:shadow"
              @click="startNewTask(agent.id, $event)"
              :disabled="creatingTask === agent.id"
            >
              <span v-if="creatingTask === agent.id" class="i-carbon-renew animate-spin"></span>
              <span v-else class="i-carbon-chat"></span>
              对话
            </button>
          </div>
          
        </div>
      </div>
    </div>
  </div>
</template>
