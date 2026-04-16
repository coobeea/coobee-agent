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
import { importAgent, exportAgent } from '@/api/agents';

const agentsStore = useAgentsStore();
const router = useRouter();

/** 删除确认 */
const confirmDeleteId = ref<string | null>(null);

/** 导入中 */
const importing = ref(false);

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
  if (target.closest('button') || target.closest('.card-actions-right')) {
    return;
  }
  openEditPage(agentId);
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
  <div class="agent-view">
    <!-- 顶栏 -->
    <header class="header">
      <div class="header-left">
        <div class="header-icon">
          <span class="i-carbon-bot inline-block h-4 w-4" />
        </div>
        <h1 class="header-title">智能体</h1>
        <span v-if="agentsStore.agentCount > 0" class="header-count">
          {{ agentsStore.agentCount }}
        </span>
      </div>
      <div class="header-right">
        <button class="icon-btn" title="刷新" @click="agentsStore.fetchAgents()">
          <span
            class="i-carbon-renew inline-block h-[15px] w-[15px]"
            :class="{ 'animate-spin': agentsStore.loading }" />
        </button>
        <button class="icon-btn" title="导入智能体" :disabled="importing" @click="openFileSelector">
          <span
            class="i-carbon-upload inline-block h-[15px] w-[15px]"
            :class="{ 'animate-pulse': importing }" />
        </button>
        <button class="create-btn" @click="openCreatePage">
          <span class="i-carbon-add inline-block h-3.5 w-3.5" />
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
    <div class="content">
      <!-- 错误 -->
      <div v-if="agentsStore.error" class="error-bar">
        <span class="i-carbon-warning-alt inline-block h-3.5 w-3.5 shrink-0" />
        <span class="flex-1 truncate">{{ agentsStore.error }}</span>
        <button class="error-retry" @click="agentsStore.fetchAgents()">重试</button>
      </div>

      <!-- 加载中 -->
      <div v-if="agentsStore.loading && agentsStore.agents.length === 0" class="empty-state">
        <div class="empty-spinner">
          <span class="i-carbon-renew inline-block h-5 w-5 animate-spin" />
        </div>
        <p class="empty-label">加载中...</p>
      </div>

      <!-- 空状态 -->
      <div v-else-if="agentsStore.agents.length === 0 && !agentsStore.loading" class="empty-state">
        <div class="empty-visual">
          <div class="empty-circle">
            <span class="i-carbon-bot inline-block h-7 w-7" />
          </div>
        </div>
        <p class="empty-heading">创建你的第一个智能体</p>
        <p class="empty-sub">智能体可以帮助你完成各种任务，定制专属的工作流程</p>
        <button class="primary-btn mt-5" @click="openCreatePage">
          <span class="i-carbon-add inline-block h-3.5 w-3.5" />
          开始创建
        </button>
      </div>

      <!-- 智能体列表 -->
      <div v-else class="agent-grid">
        <div
          v-for="agent in sortedAgents"
          :key="agent.id"
          class="agent-card"
          @click="handleCardClick(agent.id, $event)"
        >
          <div class="card-header">
            <div class="card-avatar">
              <span class="i-carbon-bot inline-block h-5 w-5" />
            </div>
            <div class="card-title-area">
              <span class="card-name" :title="agent.name">{{ agent.name }}</span>
              <span class="card-time">{{ formatTime(agent.updatedAt) }}</span>
            </div>
          </div>

          <p class="card-desc">{{ agent.description }}</p>

          <div v-if="agent.skills && agent.skills.length > 0" class="card-skills">
            <span v-for="skill in agent.skills.slice(0, 3)" :key="skill" class="skill-tag">
              {{ skill }}
            </span>
            <span v-if="agent.skills.length > 3" class="skill-more"> +{{ agent.skills.length - 3 }} </span>
          </div>

          <!-- 模型标签 -->
          <div class="card-meta">
            <span v-if="agent.model" class="meta-tag model" :title="agent.model">
              <span class="i-carbon-machine-learning-model inline-block h-3 w-3" />
              {{ agent.model.startsWith('@group:') ? agent.model.slice(7) : agent.model.split('/').pop() }}
            </span>
          </div>

          <div class="card-footer">
            <div class="card-actions-right">
              <template v-if="confirmDeleteId !== agent.id">
                <button class="action-icon" title="导出" @click="handleExport(agent.id, agent.name, $event)">
                  <span class="i-carbon-download inline-block h-3.5 w-3.5" />
                </button>
                <button class="action-icon" title="编辑" @click="openEditPage(agent.id)">
                  <span class="i-carbon-edit inline-block h-3.5 w-3.5" />
                </button>
                <button class="action-icon danger" title="删除" @click="handleDelete(agent.id, $event)">
                  <span class="i-carbon-trash-can inline-block h-3.5 w-3.5" />
                </button>
              </template>
              <template v-else>
                <button class="confirm-btn danger" @click="handleDelete(agent.id, $event)">确认删除</button>
                <button class="confirm-btn" @click="cancelDelete($event)">取消</button>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.agent-view {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  width: 100%;
  background: hsl(var(--background));
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 42px;
  padding: 0 16px;
  flex-shrink: 0;
  border-bottom: 1px solid hsl(var(--border) / 0.3);
  background: hsl(var(--surface) / 0.6);
  backdrop-filter: blur(12px);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}

.header-title {
  font-size: 13px;
  font-weight: 600;
  color: hsl(var(--foreground));
  letter-spacing: -0.01em;
}

.header-count {
  font-size: 11px;
  font-weight: 500;
  padding: 1px 7px;
  border-radius: 10px;
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--muted-foreground));
}

.header-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 7px;
  color: hsl(var(--muted-foreground));
  transition: all 0.15s ease;
}

.icon-btn:hover {
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--foreground) / 0.7);
}

.create-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 12px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.08);
  transition: all 0.15s ease;
}

.create-btn:hover {
  background: hsl(var(--primary) / 0.14);
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.error-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  border-radius: 8px;
  font-size: 12px;
  color: hsl(var(--error));
  background: hsl(var(--error) / 0.06);
  border: 1px solid hsl(var(--error) / 0.1);
}

.error-retry {
  font-size: 11px;
  font-weight: 500;
  color: hsl(var(--error));
  text-decoration: underline;
  text-underline-offset: 2px;
  flex-shrink: 0;
}

.error-retry:hover {
  opacity: 0.8;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-top: 10vh;
  text-align: center;
}

.empty-spinner {
  color: hsl(var(--muted-foreground) / 0.25);
  margin-bottom: 12px;
}

.empty-label {
  font-size: 13px;
  color: hsl(var(--muted-foreground) / 0.5);
}

.empty-visual {
  position: relative;
  width: 80px;
  height: 80px;
  margin-bottom: 24px;
}

.empty-circle {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: hsl(var(--primary) / 0.06);
  color: hsl(var(--primary) / 0.35);
  z-index: 1;
}

.empty-heading {
  font-size: 15px;
  font-weight: 600;
  color: hsl(var(--foreground) / 0.7);
  margin-bottom: 6px;
}

.empty-sub {
  font-size: 12.5px;
  color: hsl(var(--muted-foreground) / 0.55);
  line-height: 1.6;
  max-width: 280px;
}

.agent-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

@media (max-width: 640px) {
  .agent-grid {
    grid-template-columns: 1fr;
  }
}

.agent-card {
  display: flex;
  flex-direction: column;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid hsl(var(--border) / 0.35);
  background: hsl(var(--surface) / 0.6);
  transition: all 0.2s ease;
  cursor: pointer;
}

.agent-card:hover {
  background: hsl(var(--surface));
  border-color: hsl(var(--border) / 0.6);
  box-shadow:
    0 2px 8px hsl(var(--shadow) / 0.06),
    0 1px 3px hsl(var(--shadow) / 0.04);
  transform: translateY(-1px);
}

.card-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.card-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  flex-shrink: 0;
  background: linear-gradient(135deg, hsl(var(--primary) / 0.08), hsl(var(--primary) / 0.15));
  color: hsl(var(--primary) / 0.6);
  transition: all 0.2s ease;
}

.agent-card:hover .card-avatar {
  color: hsl(var(--primary) / 0.8);
  background: linear-gradient(135deg, hsl(var(--primary) / 0.1), hsl(var(--primary) / 0.2));
}

.card-title-area {
  flex: 1;
  min-width: 0;
}

.card-name {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}

.card-time {
  display: block;
  font-size: 11px;
  color: hsl(var(--muted-foreground) / 0.4);
  margin-top: 2px;
}

.card-desc {
  font-size: 12.5px;
  color: hsl(var(--muted-foreground) / 0.6);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-bottom: 10px;
}

.card-skills {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.skill-tag {
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 4px;
  background: hsl(var(--primary) / 0.06);
  color: hsl(var(--primary) / 0.65);
  font-weight: 500;
  white-space: nowrap;
}

.skill-more {
  font-size: 10px;
  color: hsl(var(--muted-foreground) / 0.4);
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.meta-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 4px;
  font-weight: 500;
  white-space: nowrap;
}

.meta-tag.model {
  background: hsl(var(--warning) / 0.08);
  color: hsl(var(--warning) / 0.7);
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid hsl(var(--border) / 0.15);
}

.card-actions-right {
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.agent-card:hover .card-actions-right {
  opacity: 1;
}

.action-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  color: hsl(var(--muted-foreground) / 0.4);
  transition: all 0.12s ease;
}

.action-icon:hover {
  background: hsl(var(--primary) / 0.08);
  color: hsl(var(--primary));
}

.action-icon.danger:hover {
  background: hsl(var(--error) / 0.08);
  color: hsl(var(--error));
}

.confirm-btn {
  padding: 3px 8px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
  transition: all 0.12s ease;
}

.confirm-btn:hover {
  background: hsl(var(--foreground) / 0.05);
}

.confirm-btn.danger {
  color: hsl(var(--error));
}

.confirm-btn.danger:hover {
  background: hsl(var(--error) / 0.08);
}

.text-btn {
  padding: 6px 12px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--muted-foreground) / 0.6);
  transition: all 0.12s ease;
}

.text-btn:hover {
  background: hsl(var(--foreground) / 0.04);
  color: hsl(var(--foreground) / 0.7);
}

.primary-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 14px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--primary-foreground));
  background: hsl(var(--primary));
  transition: all 0.15s ease;
}

.primary-btn:hover:not(:disabled) {
  background: hsl(var(--primary-hover));
}

.primary-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
</style>
